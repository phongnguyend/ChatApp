using System.Data;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using ChatApp.Application.Contracts;
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

        owner.MapDelete("/{id:guid}", async (Guid id, int revision, ClaimsPrincipal user, ChatAppDbContext db, CancellationToken ct) =>
        {
            var form = await FindOwned(db, id, user, ct);
            if (form is null)
            {
                return Results.NotFound();
            }
            if (form.Revision != revision)
            {
                return Conflict();
            }
            db.Forms.Remove(form);
            await db.SaveChangesAsync(ct);
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
            var publications = await db.FormPublications.AsNoTracking().Where(x => publicationIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
            return Results.Ok(new { total, snapshot, page = currentPage, pageSize = 50, items = rows.Select(x => new
            {
                x.Id, x.SubmittedAt, Version = publications[x.PublicationId].Version,
                Answers = JsonSerializer.Deserialize<Dictionary<string, string[]>>(x.AnswersJson, Json),
                Definition = ReadDefinition(publications[x.PublicationId].DefinitionJson)
            }) });
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
    }

    private static async Task<IResult> Submit(string token, SubmitFormRequest request, ChatAppDbContext db, CancellationToken ct)
    {
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
        var result = FormRules.ValidateAnswers(ReadDefinition(publication.DefinitionJson), request.Answers);
        if (result.Errors.Count > 0)
        {
            return Results.BadRequest(new { error = "Please check your answers.", errors = result.Errors });
        }
        db.FormResponses.Add(new FormResponse { FormId = form.Id, PublicationId = publication.Id, SubmissionKey = request.SubmissionKey, AnswersJson = JsonSerializer.Serialize(result.Answers, Json) });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Results.Ok(new { accepted = true });
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
