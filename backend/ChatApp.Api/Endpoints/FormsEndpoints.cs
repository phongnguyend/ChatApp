using System.Data;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using ChatApp.Application.Contracts;
using ChatApp.Application.Abstractions;
using ChatApp.Application.Forms;
using ChatApp.Domain.Models;
using ChatApp.Persistence;
using Microsoft.EntityFrameworkCore;
using QRCoder;

namespace ChatApp.Api.Endpoints;

public static class FormsEndpoints
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static void Map(WebApplication app)
    {
        var owner = app.MapGroup("/api/forms").RequireAuthorization();

        owner.AddEndpointFilter(async (context, next) =>
        {
            try
            {
                return await next(context);
            }
            catch (DbUpdateConcurrencyException)
            {
                return Results.Conflict(new { error = "This form changed in another session. Reload before editing." });
            }
            catch (DbUpdateException exception) when (exception.InnerException is Microsoft.Data.SqlClient.SqlException { Number: 2601 or 2627 })
            {
                return Conflict();
            }
        });

        owner.MapGet("/", async (ClaimsPrincipal user, ChatAppDbContext db, CancellationToken ct) =>
        {
            var id = UserId(user);
            return Results.Ok(await db.Forms.AsNoTracking().Where(x => x.OwnerId == id).OrderByDescending(x => x.UpdatedAt)
                .Select(x => new { x.Id, x.Title, x.IsPublished, x.PublishedVersion, x.Revision, x.UpdatedAt, x.ShareToken,
                    ResponseCount = db.FormResponses.Count(r => r.FormId == x.Id) }).ToListAsync(ct));
        });

        owner.MapPost("/", async (ClaimsPrincipal user, ChatAppDbContext db, CancellationToken ct) =>
        {
            var definition = new FormDefinition("Untitled form", "", "Thank you! Your response has been recorded.", []);
            var form = new UserForm { OwnerId = UserId(user), DraftJson = JsonSerializer.Serialize(definition, Json), ShareToken = NewToken() };
            db.Forms.Add(form);
            await db.SaveChangesAsync(ct);
            return Results.Ok(Detail(form));
        });

        owner.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal user, ChatAppDbContext db, CancellationToken ct) =>
        {
            var form = await FindOwned(db, id, user, ct);
            return form is null ? Results.NotFound() : Results.Ok(Detail(form));
        });

        owner.MapGet("/{id:guid}/qr-code", async (Guid id, string baseUrl, HttpContext context, ChatAppDbContext db, CancellationToken ct) =>
        {
            var form = await FindOwned(db, id, context.User, ct);
            if (form is null)
            {
                return Results.NotFound();
            }
            if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uiUrl) ||
                uiUrl.Scheme is not ("http" or "https") || uiUrl.AbsoluteUri.Length > 1024 || !string.IsNullOrEmpty(uiUrl.UserInfo))
            {
                return Results.BadRequest(new { error = "A valid HTTP or HTTPS form page URL is required (up to 1024 characters)." });
            }
            var shareUrl = new UriBuilder(uiUrl)
            {
                Query = $"form={Uri.EscapeDataString(form.ShareToken)}",
                Fragment = ""
            }.Uri.AbsoluteUri;
            using var data = QRCodeGenerator.GenerateQrCode(shareUrl, QRCodeGenerator.ECCLevel.Q);
            using var code = new PngByteQRCode(data);
            context.Response.Headers.CacheControl = "no-store";
            return Results.File(code.GetGraphic(8), "image/png");
        });

        owner.MapPut("/{id:guid}", async (Guid id, SaveFormRequest request, ClaimsPrincipal user, ChatAppDbContext db, CancellationToken ct) =>
        {
            var form = await FindOwned(db, id, user, ct);
            if (form is null)
            {
                return Results.NotFound();
            }
            if (form.Revision != request.Revision)
            {
                return Conflict();
            }
            if (request.Definition is null)
            {
                return Results.BadRequest(new { error = "A form definition is required." });
            }
            var errors = FormRules.ValidateDefinition(request.Definition);
            if (errors.Count != 0)
            {
                return Results.BadRequest(new { error = "Check your form settings.", errors });
            }
            form.Title = request.Definition.Title.Trim();
            form.DraftJson = JsonSerializer.Serialize(request.Definition with { Title = form.Title }, Json);
            Touch(form);
            await db.SaveChangesAsync(ct);
            return Results.Ok(Detail(form));
        }).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(6 * 1024 * 1024));

        owner.MapPost("/{id:guid}/publish", async (Guid id, FormRevisionRequest request, ClaimsPrincipal user, ChatAppDbContext db, CancellationToken ct) =>
        {
            var form = await FindOwned(db, id, user, ct);
            if (form is null)
            {
                return Results.NotFound();
            }
            if (form.Revision != request.Revision)
            {
                return Conflict();
            }
            var errors = FormRules.ValidateDefinition(ReadDefinition(form.DraftJson), true);
            if (errors.Count > 0)
            {
                return Results.BadRequest(new { error = "The form is not ready to publish.", errors });
            }
            form.PublishedVersion++;
            form.IsPublished = true;
            Touch(form);
            db.FormPublications.Add(new FormPublication { FormId = form.Id, Version = form.PublishedVersion, DefinitionJson = form.DraftJson });
            await db.SaveChangesAsync(ct);
            return Results.Ok(Detail(form));
        });

        owner.MapPost("/{id:guid}/close", async (Guid id, FormRevisionRequest request, ClaimsPrincipal user, ChatAppDbContext db, CancellationToken ct) =>
        {
            var form = await FindOwned(db, id, user, ct);
            if (form is null)
            {
                return Results.NotFound();
            }
            if (form.Revision != request.Revision)
            {
                return Conflict();
            }
            form.IsPublished = false;
            Touch(form);
            await db.SaveChangesAsync(ct);
            return Results.Ok(Detail(form));
        });

        owner.MapPost("/{id:guid}/duplicate", async (Guid id, ClaimsPrincipal user, ChatAppDbContext db, CancellationToken ct) =>
        {
            var source = await FindOwned(db, id, user, ct);
            if (source is null)
            {
                return Results.NotFound();
            }
            var definition = ReadDefinition(source.DraftJson);
            var title = "Copy of " + source.Title[..Math.Min(192, source.Title.Length)];
            var copy = new UserForm { OwnerId = UserId(user), Title = title, DraftJson = JsonSerializer.Serialize(definition with { Title = title }, Json), ShareToken = NewToken() };
            db.Forms.Add(copy);
            await db.SaveChangesAsync(ct);
            return Results.Ok(Detail(copy));
        });

        owner.MapDelete("/{id:guid}", async (Guid id, int revision, ClaimsPrincipal user, ChatAppDbContext db, IUploadObjectStorage storage, ILoggerFactory loggerFactory, CancellationToken ct) =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            var form = await FindOwned(db, id, user, ct);
            if (form is null)
            {
                return Results.NotFound();
            }
            if (form.Revision != revision)
            {
                return Conflict();
            }
            var keys = await (from attachment in db.FormResponseAttachments
                join response in db.FormResponses on attachment.ResponseId equals response.Id
                where response.FormId == id
                select attachment.StorageKey).ToListAsync(ct);
            db.Forms.Remove(form);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            await CleanupFiles(keys, storage, loggerFactory);
            return Results.NoContent();
        });

        owner.MapGet("/{id:guid}/responses", async (Guid id, int? page, DateTimeOffset? before, ClaimsPrincipal user, ChatAppDbContext db, CancellationToken ct) =>
        {
            if (await FindOwned(db, id, user, ct) is null)
            {
                return Results.NotFound();
            }
            var currentPage = Math.Clamp(page ?? 1, 1, 1000000);
            var snapshot = before ?? DateTimeOffset.UtcNow;
            var query = db.FormResponses.AsNoTracking().Where(x => x.FormId == id && x.SubmittedAt <= snapshot);
            var total = await query.CountAsync(ct);
            var rows = await query.OrderByDescending(x => x.SubmittedAt).ThenBy(x => x.Id).Skip((currentPage - 1) * 50).Take(50).ToListAsync(ct);
            var publicationIds = rows.Select(x => x.PublicationId).Distinct().ToArray();
            var responseIds = rows.Select(x => x.Id).ToArray();
            var attachments = await db.FormResponseAttachments.AsNoTracking().Where(x => responseIds.Contains(x.ResponseId))
                .Select(x => new { x.Id, x.ResponseId, x.QuestionId, x.FileName, Size = x.SizeBytes }).ToListAsync(ct);
            var publications = await db.FormPublications.AsNoTracking().Where(x => publicationIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
            return Results.Ok(new { total, snapshot, page = currentPage, pageSize = 50, items = rows.Select(x => new
            {
                x.Id, x.SubmittedAt, Version = publications[x.PublicationId].Version,
                Answers = JsonSerializer.Deserialize<Dictionary<string, string[]>>(x.AnswersJson, Json),
                Attachments = attachments.Where(a => a.ResponseId == x.Id),
                Definition = ReadDefinition(publications[x.PublicationId].DefinitionJson)
            }) });
        });

        owner.MapGet("/{id:guid}/attachments/{attachmentId:guid}", async (Guid id, Guid attachmentId, HttpContext context, ChatAppDbContext db, IUploadObjectStorage storage, CancellationToken ct) =>
        {
            var ownerId = UserId(context.User);
            var attachment = await (from a in db.FormResponseAttachments.AsNoTracking()
                join r in db.FormResponses on a.ResponseId equals r.Id
                join f in db.Forms on r.FormId equals f.Id
                where a.Id == attachmentId && f.Id == id && f.OwnerId == ownerId
                select a).SingleOrDefaultAsync(ct);
            if (attachment is null)
            {
                return Results.NotFound();
            }
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers.XContentTypeOptions = "nosniff";
            var stream = await storage.OpenReadAsync(attachment.StorageKey, ct);
            return stream is null ? Results.NotFound() : Results.File(stream, "application/octet-stream", attachment.FileName);
        });

        var publicRoutes = app.MapGroup("/api/public/forms").AllowAnonymous();

        publicRoutes.MapGet("/{token}", async (string token, ChatAppDbContext db, CancellationToken ct) =>
        {
            var form = await db.Forms.AsNoTracking().SingleOrDefaultAsync(x => x.ShareToken == token && x.IsPublished, ct);
            if (form is null)
            {
                return Results.NotFound(new { error = "This form is unavailable or no longer accepting responses." });
            }
            var publication = await db.FormPublications.AsNoTracking().SingleAsync(x => x.FormId == form.Id && x.Version == form.PublishedVersion, ct);
            return Results.Ok(new { version = publication.Version, definition = ReadDefinition(publication.DefinitionJson) });
        });

        publicRoutes.MapPost("/{token}/responses", Submit)
            .RequireRateLimiting("form-submissions")
            .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(512_000));

        publicRoutes.MapPost("/{token}/attachments", UploadAttachment)
            .RequireRateLimiting("form-uploads")
            .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(21 * 1024 * 1024));
    }

    private static async Task<IResult> UploadAttachment(string token, HttpRequest request, ChatAppDbContext db, IUploadObjectStorage storage, CancellationToken ct)
    {
        if (!request.HasFormContentType)
        {
            return Results.BadRequest(new { error = "Choose a file to upload." });
        }
        IFormCollection data;
        try
        {
            data = await request.ReadFormAsync(new Microsoft.AspNetCore.Http.Features.FormOptions { MultipartBodyLengthLimit = 20 * 1024 * 1024 }, ct);
        }
        catch (Exception exception) when (exception is InvalidDataException or BadHttpRequestException)
        {
            return Results.BadRequest(new { error = "Each file must be at most 20 MB." });
        }
        if (data.Files.Count != 1 || data.Files[0].Length > 20 * 1024 * 1024 ||
            !Guid.TryParse(data["submissionKey"], out var submissionKey) || submissionKey == Guid.Empty ||
            !int.TryParse(data["version"], out var version))
        {
            return Results.BadRequest(new { error = "Upload one file up to 20 MB with a valid submission key and form version." });
        }
        var file = data.Files[0];
        FormAttachmentUpload upload;
        await using (var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct))
        {
            var form = await db.Forms.FromSqlInterpolated($"SELECT * FROM [Forms] WITH (UPDLOCK, HOLDLOCK) WHERE [ShareToken] = {token}").SingleOrDefaultAsync(ct);
            if (form is null || !form.IsPublished)
            {
                return Results.NotFound(new { error = "This form is unavailable." });
            }
            if (version != form.PublishedVersion)
            {
                return Results.Conflict(new { error = "The form has changed. Reload it before uploading." });
            }
            var publication = await db.FormPublications.SingleAsync(x => x.FormId == form.Id && x.Version == version, ct);
            var questionId = data["questionId"].ToString();
            var question = Flatten(ReadDefinition(publication.DefinitionJson).Nodes).FirstOrDefault(x => x.Id == questionId && x.Kind == "attachment");
            if (question is null)
            {
                return Results.BadRequest(new { error = "Unknown attachment question." });
            }
            if (!FormRules.IsAllowedAttachment(question, SafeFileName(file.FileName)))
            {
                return Results.BadRequest(new { error = $"File extension is not allowed. Choose: {string.Join(", ", question.AllowedExtensions)}." });
            }
            if (file.Length > question.MaxFileSizeMb * 1024L * 1024)
            {
                return Results.BadRequest(new { error = $"Each file must be at most {question.MaxFileSizeMb} MB." });
            }
            if (await db.FormResponses.AnyAsync(x => x.FormId == form.Id && x.SubmissionKey == submissionKey, ct))
            {
                return Results.Conflict(new { error = "This response has already been submitted." });
            }
            var pending = db.FormAttachmentUploads.Where(x => x.FormId == form.Id && x.SubmissionKey == submissionKey && x.ExpiresAt > DateTimeOffset.UtcNow);
            // Allow replacements while bounding abandoned uploads for an individual response.
            if (await pending.CountAsync(ct) >= 100 || (await pending.SumAsync(x => (long?)x.SizeBytes, ct) ?? 0) + file.Length > 40 * 1024 * 1024)
            {
                return Results.BadRequest(new { error = "Upload allowance reached for this response. Reload the form to start again." });
            }
            upload = new FormAttachmentUpload
            {
                FormId = form.Id, PublicationId = publication.Id, SubmissionKey = submissionKey,
                QuestionId = questionId, FileName = SafeFileName(file.FileName), SizeBytes = file.Length,
                StorageKey = $"form-attachments/{form.Id:N}/pending/{NewToken()}", ExpiresAt = DateTimeOffset.UtcNow.AddHours(24)
            };
            db.FormAttachmentUploads.Add(upload);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        // Reserve metadata before writing: interrupted uploads remain discoverable by the expiry worker.
        await using var stream = file.OpenReadStream();
        await storage.WriteAsync(upload.StorageKey, stream, ct);
        upload.Ready = true;
        await db.SaveChangesAsync(ct);
        return Results.Ok(new { upload.Id, upload.FileName, Size = upload.SizeBytes, upload.ExpiresAt });
    }

    private static async Task<IResult> Submit(string token, HttpRequest httpRequest, ChatAppDbContext db, CancellationToken ct)
    {
        if (!httpRequest.HasJsonContentType())
        {
            return Results.StatusCode(StatusCodes.Status415UnsupportedMediaType);
        }
        SubmitFormRequest? request;
        try
        {
            request = await httpRequest.ReadFromJsonAsync<SubmitFormRequest>(Json, ct);
        }
        catch (Exception exception) when (exception is JsonException or BadHttpRequestException)
        {
            return Results.BadRequest(new { error = "Invalid submission." });
        }
        if (request?.Answers is null || request.Answers.Count > 200)
        {
            return Results.BadRequest(new { error = "Provide answers for at most 200 questions." });
        }
        // Lock publication state through the insert: closing or republishing cannot race acceptance.
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var form = await db.Forms.FromSqlInterpolated($"SELECT * FROM [Forms] WITH (UPDLOCK, HOLDLOCK) WHERE [ShareToken] = {token}").SingleOrDefaultAsync(ct);
        if (form is null || request.SubmissionKey == Guid.Empty)
        {
            return Results.NotFound(new { error = "This form is unavailable." });
        }
        if (await db.FormResponses.AnyAsync(x => x.FormId == form.Id && x.SubmissionKey == request.SubmissionKey, ct))
        {
            return Results.Ok(new { accepted = true });
        }
        if (!form.IsPublished)
        {
            return Results.BadRequest(new { error = "This form is no longer accepting responses." });
        }
        if (request.Version != form.PublishedVersion)
        {
            return Results.Conflict(new { error = "The form has changed. Reload it before submitting." });
        }
        var publication = await db.FormPublications.SingleAsync(x => x.FormId == form.Id && x.Version == request.Version, ct);
        var definition = ReadDefinition(publication.DefinitionJson);
        var attachmentQuestions = Flatten(definition.Nodes).Where(x => x.Kind == "attachment").ToDictionary(x => x.Id);
        var references = request.Attachments ?? [];
        if (references.Count > 200 || references.Any(x => x.Value is null || x.Value.Length > 10))
        {
            return Results.BadRequest(new { error = "Invalid attachment references." });
        }
        var uploadIds = references.Values.SelectMany(x => x).ToArray();
        if (uploadIds.Length > 100 || uploadIds.Distinct().Count() != uploadIds.Length)
        {
            return Results.BadRequest(new { error = "Invalid or duplicate attachment references." });
        }
        var uploads = await db.FormAttachmentUploads.Where(x => uploadIds.Contains(x.Id) && x.FormId == form.Id &&
            x.PublicationId == publication.Id && x.SubmissionKey == request.SubmissionKey && x.Ready && x.ExpiresAt > DateTimeOffset.UtcNow).ToListAsync(ct);
        if (uploads.Count != uploadIds.Length || uploads.Any(x => !references.TryGetValue(x.QuestionId, out var ids) || !ids.Contains(x.Id)))
        {
            return Results.BadRequest(new { error = "An upload is expired or unavailable. Remove it and upload the file again." });
        }
        if (uploads.Sum(x => x.SizeBytes) > 20 * 1024 * 1024)
        {
            return Results.BadRequest(new { error = "Attachments must total at most 20 MiB." });
        }
        foreach (var question in attachmentQuestions.Values)
        {
            request.Answers[question.Id] = uploads.Where(x => x.QuestionId == question.Id).Select(x => x.FileName).ToArray();
        }
        var result = FormRules.ValidateAnswers(definition, request.Answers);
        foreach (var upload in uploads)
        {
            if (attachmentQuestions.TryGetValue(upload.QuestionId, out var question) && upload.SizeBytes > question.MaxFileSizeMb * 1024L * 1024)
            {
                result.Errors[question.Id] = $"Each file must be at most {question.MaxFileSizeMb} MB.";
            }
        }
        if (uploads.Any(x => !result.Answers.ContainsKey(x.QuestionId)))
        {
            return Results.BadRequest(new { error = "An attachment belongs to a hidden question." });
        }
        if (result.Errors.Count > 0)
        {
            return Results.BadRequest(new { error = "Please check your answers.", errors = result.Errors });
        }
        var response = new FormResponse { FormId = form.Id, PublicationId = publication.Id, SubmissionKey = request.SubmissionKey, AnswersJson = JsonSerializer.Serialize(result.Answers, Json) };
        db.FormResponses.Add(response);
        await db.SaveChangesAsync(ct);
        foreach (var upload in uploads)
        {
            db.FormResponseAttachments.Add(new FormResponseAttachment
            {
                ResponseId = response.Id, QuestionId = upload.QuestionId, FileName = upload.FileName,
                StorageKey = upload.StorageKey, SizeBytes = upload.SizeBytes
            });
            db.FormAttachmentUploads.Remove(upload);
        }
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Results.Ok(new { accepted = true });
    }

    private static async Task CleanupFiles(IEnumerable<string> keys, IUploadObjectStorage storage, ILoggerFactory loggerFactory)
    {
        foreach (var key in keys)
        {
            try
            {
                await storage.DeleteAsync(key, CancellationToken.None);
            }
            catch (Exception exception)
            {
                loggerFactory.CreateLogger("FormAttachments").LogWarning(exception, "Could not remove form attachment {StorageKey}", key);
            }
        }
    }

    private static IEnumerable<FormNode> Flatten(FormNode[] nodes) => nodes.SelectMany(node => new[] { node }.Concat(Flatten(node.Children)));

    private static string SafeFileName(string name)
    {
        var clean = new string(name.Replace('\\', '/').Split('/').Last().Where(c => !char.IsControl(c)).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(clean) ? "attachment" : clean[..Math.Min(clean.Length, 255)];
    }

    private static Guid UserId(ClaimsPrincipal user) => Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private static Task<UserForm?> FindOwned(ChatAppDbContext db, Guid id, ClaimsPrincipal user, CancellationToken ct)
    {
        var ownerId = UserId(user);
        return db.Forms.SingleOrDefaultAsync(x => x.Id == id && x.OwnerId == ownerId, ct);
    }

    private static FormDefinition ReadDefinition(string json) => JsonSerializer.Deserialize<FormDefinition>(json, Json)!;

    private static object Detail(UserForm form) => new { form.Id, form.Title, form.Revision, form.IsPublished, form.PublishedVersion, form.ShareToken, form.UpdatedAt, Definition = ReadDefinition(form.DraftJson) };

    private static string NewToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();

    private static IResult Conflict() => Results.Conflict(new { error = "This form changed in another session. Reload before editing." });

    private static void Touch(UserForm form)
    {
        form.Revision++;
        form.UpdatedAt = DateTimeOffset.UtcNow;
    }
}
