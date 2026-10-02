using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using ChatApp.Infrastructure.DocumentSigning;

namespace ChatApp.Api.Endpoints;

public static class SignatureEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/documents/files/signing-options", (SignatureRequestService signing) => Results.Ok(signing.EnabledProviders)).RequireAuthorization();
        var group = app.MapGroup("/api/documents/files/{id:guid}/signatures").RequireAuthorization();
        group.AddEndpointFilter(async (context, next) =>
        {
            context.HttpContext.Response.Headers.CacheControl = "no-store";
            try
            {
                var id = Guid.Parse(context.HttpContext.Request.RouteValues["id"]!.ToString()!);
                var userId = Guid.Parse(context.HttpContext.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
                var documents = context.HttpContext.RequestServices.GetRequiredService<DocumentsEndpoints>();
                if (!await documents.CanSignAsync(id, userId, context.HttpContext.RequestAborted))
                {
                    return Results.NotFound(new { error = "Document not found or you do not have permission to sign it." });
                }
                return await next(context);
            }
            catch (KeyNotFoundException ex)
            {
                return Results.NotFound(new { error = ex.Message });
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return Results.Conflict(new { error = ex.Message });
            }
            catch (DbUpdateException)
            {
                return Results.Conflict(new { error = "The signing request could not be saved. Refresh the request list before trying again." });
            }
            catch (HttpRequestException ex)
            {
                return Results.Json(new { error = ex.Message }, statusCode: 502);
            }
            catch (OperationCanceledException) when (!context.HttpContext.RequestAborted.IsCancellationRequested)
            {
                return Results.Json(new { error = "The signing provider timed out. Refresh the request list before trying again." }, statusCode: 504);
            }
        });
        group.MapGet("", async (Guid id, HttpContext context, SignatureRequestService signing, CancellationToken ct) =>
            Results.Ok(await signing.ListAsync(id, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), false, ct)));
        group.MapPost("", async (Guid id, SignatureInput input, HttpContext context, SignatureRequestService signing, CancellationToken ct) =>
            Results.Ok(await signing.CreateAsync(id, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), input, ct)));
        group.MapDelete("/{requestId:guid}", async (Guid id, Guid requestId, HttpContext context, SignatureRequestService signing, CancellationToken ct) =>
        {
            await signing.DeleteNeedsReviewAsync(id, requestId, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), false, ct);
            return Results.Ok(new { deleted = true });
        });
        group.MapPost("/{requestId:guid}/prepare", async (Guid id, Guid requestId, HttpContext context, SignatureRequestService signing, CancellationToken ct) =>
        {
            var row = await signing.FindAsync(id, requestId, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), false, ct);
            return Results.Ok(new { url = await signing.PrepareAsync(row, ct) });
        });
        group.MapPost("/{requestId:guid}/refresh", async (Guid id, Guid requestId, HttpContext context, SignatureRequestService signing, CancellationToken ct) =>
        {
            var row = await signing.FindAsync(id, requestId, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), false, ct);
            return Results.Ok(await signing.RefreshAsync(row, ct));
        });
        group.MapGet("/{requestId:guid}/download", async (Guid id, Guid requestId, HttpContext context, SignatureRequestService signing, CancellationToken ct, bool audit = false) =>
        {
            var row = await signing.FindAsync(id, requestId, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), false, ct);
            return Results.File(await signing.DownloadAsync(row, audit, ct), "application/pdf", $"{(audit ? "audit" : "signed")}-{row.Id}.pdf");
        });
        group.MapGet("/{requestId:guid}/original", async (Guid id, Guid requestId, HttpContext context, SignatureRequestService signing, SigningStorage storage, CancellationToken ct) =>
        {
            var row = await signing.FindAsync(id, requestId, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), false, ct);
            return Results.File(await storage.ReadAsync(row.OriginalStorageKey, ct), "application/pdf", row.OriginalFileName);
        });
        group.MapGet("/{requestId:guid}/fields", async (Guid id, Guid requestId, HttpContext context, SignatureRequestService signing, CancellationToken ct) =>
        {
            var row = await signing.FindAsync(id, requestId, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), false, ct);
            return Results.Ok(await signing.GetFieldsAsync(row, ct));
        });
        // Only the creator signs an in-app request, so writes never use administrator read access.
        group.MapPut("/{requestId:guid}/fields", async (Guid id, Guid requestId, SigningFieldsInput input, HttpContext context, SignatureRequestService signing, CancellationToken ct) =>
        {
            var row = await signing.FindAsync(id, requestId, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), false, ct);
            return Results.Ok(await signing.SaveFieldsAsync(row, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), input, ct));
        });
        group.MapPost("/{requestId:guid}/complete", async (Guid id, Guid requestId, HttpContext context, SignatureRequestService signing, CancellationToken ct) =>
        {
            var row = await signing.FindAsync(id, requestId, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), false, ct);
            if (context.Request.ContentType?.StartsWith("application/pdf", StringComparison.OrdinalIgnoreCase) != true)
            {
                return Results.BadRequest(new { error = "Upload the signed document as application/pdf." });
            }
            // Drawn signatures add to the original size, so allow headroom above the attachment limit.
            var limit = (long)SigningStorage.MaximumPdfBytes * 2;
            var bodyLimit = context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
            if (bodyLimit is { IsReadOnly: false })
            {
                bodyLimit.MaxRequestBodySize = limit + 1;
            }
            if (context.Request.ContentLength > limit)
            {
                return Results.BadRequest(new { error = "The signed document is too large." });
            }
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = await context.Request.Body.ReadAsync(chunk, ct)) > 0)
            {
                buffer.Write(chunk, 0, read);
                if (buffer.Length > limit)
                {
                    return Results.BadRequest(new { error = "The signed document is too large." });
                }
            }
            return Results.Ok(await signing.CompleteAsync(row, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), buffer.ToArray(), ct));
        });
    }
}
