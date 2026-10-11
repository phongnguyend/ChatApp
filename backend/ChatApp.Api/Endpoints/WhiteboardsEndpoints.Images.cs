using System.Security.Claims;
using ChatApp.Api.Services;
using ChatApp.Application.Abstractions;
using ChatApp.Domain.Models;
using ChatApp.Infrastructure.Storage;
using ChatApp.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Endpoints;

public static partial class WhiteboardsEndpoints
{
    private static void MapImages(RouteGroupBuilder group)
    {
        group.MapPost("/{id:guid}/images", async (Guid id, HttpRequest request, ClaimsPrincipal user, ChatAppDbContext db, WhiteboardService boards, IUploadObjectStorage storage, IConfiguration configuration, CancellationToken ct) =>
        {
            var userId = WhiteboardService.UserId(user);
            await boards.Access(id, userId, true, ct);
            if (!request.HasFormContentType)
            {
                return Results.BadRequest(new { error = "Upload a PNG, JPEG, or WebP image." });
            }
            var data = await request.ReadFormAsync(ct);
            if (data.Files.Count != 1 || data.Files[0].Length is < 1 or > 5242880)
            {
                return Results.BadRequest(new { error = "Choose one image up to 5 MB." });
            }
            var file = data.Files[0];
            await using var input = file.OpenReadStream();
            using var buffer = new MemoryStream();
            await input.CopyToAsync(buffer, ct);
            var bytes = buffer.ToArray();
            var png = bytes.Length >= 8 && bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 });
            var jpeg = bytes.Length >= 3 && bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255;
            var webp = bytes.Length >= 12 && System.Text.Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && System.Text.Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP";
            if (!png && !jpeg && !webp)
            {
                return Results.BadRequest(new { error = "Only PNG, JPEG, and WebP images are allowed." });
            }
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            await FormStorageUsage.Lock(db, userId, ct);
            if (!await FormStorageUsage.HasCapacity(db, configuration, userId, file.Length, ct))
            {
                return Results.Json(new { error = "Your storage is full. Remove unused files in My Documents." }, statusCode: 413);
            }
            var suffix = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(12));
            var name = $"Whiteboard image {suffix}.{(png ? "png" : jpeg ? "jpg" : "webp")}";
            var document = new StoredDocument { OwnerUserId = userId, Name = name, NormalizedName = name.ToUpperInvariant(), StorageKey = $"whiteboards/{id:N}/{suffix}", ContentType = png ? "image/png" : jpeg ? "image/jpeg" : "image/webp", SizeBytes = bytes.Length };
            // Normal documents participate in uploader quota and manual cleanup.
            db.StoredDocuments.Add(document);
            await db.SaveChangesAsync(ct);
            var image = new WhiteboardImage { WhiteboardId = id, DocumentId = document.Id };
            db.WhiteboardImages.Add(image);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            buffer.Position = 0;
            await storage.WriteAsync(document.StorageKey, buffer, ct);
            return Results.Ok(new { ImageId = image.Id, document.Name });
        }).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(6 * 1024 * 1024));

        group.MapGet("/{id:guid}/images/{imageId:guid}", async (Guid id, Guid imageId, ClaimsPrincipal user, WhiteboardService boards, ChatAppDbContext db, IUploadObjectStorage storage, HttpResponse response, CancellationToken ct) =>
        {
            await boards.Access(id, WhiteboardService.UserId(user), false, ct);
            var document = await db.WhiteboardImages.Where(x => x.WhiteboardId == id && x.Id == imageId).Join(db.StoredDocuments.Where(x => x.DeletedAt == null), i => i.DocumentId, d => d.Id, (i, d) => d).SingleOrDefaultAsync(ct);
            if (document is null || document.ContentType is not ("image/png" or "image/jpeg" or "image/webp"))
            {
                return Results.NotFound();
            }
            var stream = await storage.OpenReadAsync(document.StorageKey, ct);
            response.Headers.CacheControl = "no-store";
            response.Headers.XContentTypeOptions = "nosniff";
            return stream is null ? Results.NotFound() : Results.File(stream, document.ContentType);
        });

    }
}
