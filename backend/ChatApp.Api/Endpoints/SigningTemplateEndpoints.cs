using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using ChatApp.Infrastructure.DocumentSigning;

namespace ChatApp.Api.Endpoints;

public static class SigningTemplateEndpoints
{
    // Templates are personal, so every operation is scoped to the signed-in user, including administrators.
    // The route parameter is named templateId so the attachment ownership check does not apply to it.
    public static void Map(WebApplication app)
    {
        var group = app.MapGroup("/api/signing-templates").RequireAuthorization();

        group.AddEndpointFilter(async (context, next) =>
        {
            context.HttpContext.Response.Headers.CacheControl = "no-store";
            try
            {
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
                return Results.Conflict(new { error = "The template could not be saved. A template with this name may already exist; reload the list and try again." });
            }
        });

        group.MapGet("", async (HttpContext context, SigningTemplateService templates, CancellationToken ct) =>
            Results.Ok(await templates.ListAsync(Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), ct)));

        group.MapGet("/{templateId:guid}", async (Guid templateId, HttpContext context, SigningTemplateService templates, CancellationToken ct) =>
            Results.Ok(await templates.GetAsync(templateId, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), ct)));

        group.MapPost("", async (SigningTemplateInput input, HttpContext context, SigningTemplateService templates, CancellationToken ct) =>
            Results.Ok(await templates.CreateAsync(Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), input, ct)));

        group.MapPut("/{templateId:guid}", async (Guid templateId, SigningTemplateInput input, HttpContext context, SigningTemplateService templates, CancellationToken ct) =>
            Results.Ok(await templates.UpdateAsync(templateId, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), input, ct)));

        group.MapPatch("/{templateId:guid}", async (Guid templateId, SigningTemplateRenameInput input, HttpContext context, SigningTemplateService templates, CancellationToken ct) =>
            Results.Ok(await templates.RenameAsync(templateId, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), input, ct)));

        group.MapDelete("/{templateId:guid}", async (Guid templateId, HttpContext context, SigningTemplateService templates, CancellationToken ct) =>
        {
            await templates.DeleteAsync(templateId, Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!), ct);
            return Results.Ok(new { deleted = true });
        });
    }
}
