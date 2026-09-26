using System.Security.Claims;
using ChatApp.Application.Contracts;
using ChatApp.Domain.Security;
using ChatApp.Persistence;
using ChatApp.Domain.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ChatApp.Api.Hubs;
using ChatApp.Infrastructure.Caching;
using Microsoft.AspNetCore.SignalR;

namespace ChatApp.Api.Authentication;

public static class AccountEndpoints
{
    public static void MapAccounts(this WebApplication app)
    {
        var users = app.MapGroup("/api/admin/users").RequireAuthorization(AppRoles.ManageUsers);
        users.MapPut("/{userId:guid}/password-authentication", (Guid userId, ManagePasswordAuthenticationRequest request,
            ClaimsPrincipal principal, UserManager<ChatUser> manager, ChatAppDbContext db, CancellationToken ct) =>
            UserAdministration.SavePasswordAuthenticationAsync(userId, request, principal, manager, db, ct))
            .RequireRateLimiting("password-auth");
        users.MapPost("/", (ManageUserRequest request, ClaimsPrincipal principal, UserManager<ChatUser> manager, ChatAppDbContext db, CancellationToken ct) =>
            UserAdministration.SaveAsync(null, request, principal, manager, db, ct));
        users.MapPut("/{userId:guid}", (Guid userId, ManageUserRequest request, ClaimsPrincipal principal, UserManager<ChatUser> manager, ChatAppDbContext db, CancellationToken ct) =>
            UserAdministration.SaveAsync(userId, request, principal, manager, db, ct));
        users.MapGet("/", async (ChatAppDbContext db, CancellationToken ct) =>
        {
            var accounts = await db.Users.AsNoTracking().OrderBy(x => x.Email)
                .Select(x => new { x.Id, username = x.UserName, x.Email, x.FirstName, x.LastName, x.PhoneNumber, x.IsEnabled,
                    x.AllowPasswordAuthentication, x.LockoutEnabled, x.LockoutEnd, x.AccessFailedCount, HasPassword = x.PasswordHash != null,
                    HasExternalLogin = db.UserLogins.Any(login => login.UserId == x.Id) }).ToListAsync(ct);
            var memberships = await (from membership in db.UserRoles
                join role in db.Roles on membership.RoleId equals role.Id
                select new { membership.UserId, role.Name }).ToListAsync(ct);
            var rolesByUser = memberships.ToLookup(x => x.UserId, x => x.Name);
            return Results.Ok(accounts.Select(x => new { x.Id, x.username, x.Email, x.FirstName, x.LastName, x.PhoneNumber, x.IsEnabled, x.AllowPasswordAuthentication, x.LockoutEnabled, x.LockoutEnd, x.AccessFailedCount, x.HasPassword, x.HasExternalLogin, roles = rolesByUser[x.Id].ToArray() }));
        });
        users.MapPatch("/{userId:guid}/enabled", async (Guid userId, EnabledRequest request, ClaimsPrincipal principal, ChatAppDbContext db, CancellationToken ct) =>
        {
            if (userId.ToString() == principal.FindFirstValue(ClaimTypes.NameIdentifier) && !request.IsEnabled)
                return Results.BadRequest(new { error = "You cannot disable your own account." });
            // Serialize administrator status changes to prevent disabling the last enabled admin concurrently.
            await using var transaction = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
            var account = await db.Users.SingleOrDefaultAsync(x => x.Id == userId, ct);
            if (account is null) return Results.NotFound();
            var adminIds = from membership in db.UserRoles join role in db.Roles on membership.RoleId equals role.Id
                           where role.Name == AppRoles.GlobalAdmin select membership.UserId;
            if (!request.IsEnabled && await adminIds.ContainsAsync(userId, ct)
                && !await db.Users.AnyAsync(x => x.Id != userId && x.IsEnabled && adminIds.Contains(x.Id), ct))
                return Results.Conflict(new { error = "At least one Global Admin must remain enabled." });
            if (account.IsEnabled != request.IsEnabled)
                ActivityAudit.Add(db, request.IsEnabled ? "AccountEnabled" : "AccountDisabled", account, principal);
            account.IsEnabled = request.IsEnabled;
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return Results.NoContent();
        });


        app.MapGet("/api/admin/roles", () => new[] { AppRoles.User, AppRoles.GlobalAdmin }).RequireAuthorization(AppRoles.ManageUsers);
        app.MapGet("/api/auth/me", Profile).RequireAuthorization();
        app.MapPut("/api/auth/me", async (UserProfileRequest request, HttpContext context, UserManager<ChatUser> manager, ChatAppDbContext db, PresenceTracker presence, IHubContext<ChatHub> hubContext) =>
        {
            var first = request.FirstName?.Trim(); var last = request.LastName?.Trim(); var phone = request.PhoneNumber?.Trim();
            if (first?.Length > 100 || last?.Length > 100 || phone?.Length > 50)
                return Results.BadRequest(new { error = "Names must be at most 100 characters and phone at most 50 characters." });
            var user = await manager.GetUserAsync(context.User);
            if (user is null) return Results.Unauthorized();
            await using var transaction = await db.Database.BeginTransactionAsync();
            var changed = user.FirstName != first || user.LastName != last || user.PhoneNumber != phone;
            user.FirstName = first; user.LastName = last;
            if (user.PhoneNumber != phone) user.PhoneNumberConfirmed = false;
            user.PhoneNumber = phone;
            var result = await manager.UpdateAsync(user);
            if (result.Succeeded)
            {
                if (changed) ActivityAudit.Add(db, "UserUpdated", user, context.User, new { reason = "SelfService" });
                await db.SaveChangesAsync();
                await transaction.CommitAsync();
                presence.UpdateDisplayName(user.Id, user.DisplayName);
                await hubContext.Clients.All.SendAsync("UserDisplayNameUpdated", new UserDisplayNameUpdatedDto(user.Id, user.DisplayName));
            }
            return result.Succeeded ? Results.NoContent() : Results.BadRequest(new { error = string.Join(" ", result.Errors.Select(x => x.Description)) });
        }).RequireAuthorization();
        app.MapPost("/api/auth/logout", async (HttpContext context, UserManager<ChatUser> manager, ChatAppDbContext db) =>
        {
            var user = await manager.GetUserAsync(context.User);
            if (user is not null)
            {
                await using var transaction = await db.Database.BeginTransactionAsync();
                var result = await manager.UpdateSecurityStampAsync(user);
                if (!result.Succeeded) return Results.Problem("Could not revoke the session.");
                ActivityAudit.Add(db, "LoggedOut", user, context.User);
                await db.SaveChangesAsync();
                await transaction.CommitAsync();
            }
            context.Response.Cookies.Delete("chatapp-media", new CookieOptions { Path = "/api" });
            return Results.NoContent();
        }).RequireAuthorization();
    }

    private static async Task<IResult> Profile(HttpContext context, UserManager<ChatUser> manager)
    {
        context.Response.Headers.CacheControl = "no-store";
        var user = await manager.GetUserAsync(context.User);
        if (user is null || !user.IsEnabled) return Results.Unauthorized();
        var chat = user;
        return Results.Ok(new { user.Id, Username = chat.UserName, chat.DisplayName, chat.AvatarUrl, user.Email,
            user.FirstName, user.LastName, user.PhoneNumber, user.IsEnabled, user.AllowPasswordAuthentication,
            HasPassword = await manager.HasPasswordAsync(user),
            HasExternalLogin = (await manager.GetLoginsAsync(user)).Count > 0,
            Roles = await manager.GetRolesAsync(user) });
    }
}
