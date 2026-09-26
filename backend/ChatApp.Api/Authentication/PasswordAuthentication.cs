using ChatApp.Domain.Security;
using Microsoft.AspNetCore.Identity;
using ChatApp.Domain.Models;
using ChatApp.Persistence;

namespace ChatApp.Api.Authentication;

public static class PasswordAuthentication
{
    public static void MapPasswordSignIn(this WebApplication app)
    {
        app.MapPost("/api/auth/login", async (PasswordLoginRequest request, HttpContext context,
            UserManager<ChatUser> manager, SignInManager<ChatUser> signIn, JwtSessionService sessions) =>
        {
            NoCache(context);
            if (string.IsNullOrWhiteSpace(request.Username) || request.Username.Length > 256
                || string.IsNullOrEmpty(request.Password) || request.Password.Length > 1024)
                return InvalidCredentials();
            var user = await manager.FindByEmailAsync(request.Username.Trim())
                ?? await manager.FindByNameAsync(request.Username.Trim());
            context.Items[ActivityAudit.TargetKey] = user;
            if (user is null || !user.IsEnabled || !user.AllowPasswordAuthentication)
            {
                context.Items[ActivityAudit.ReasonKey] = user is null ? "UnknownAccount" : !user.IsEnabled ? "AccountDisabled" : "PasswordAuthenticationDisabled";
                return InvalidCredentials();
            }
            // Never bypass MFA when issuing an application token.
            if (await manager.GetTwoFactorEnabledAsync(user)) return InvalidCredentials();
            var wasLocked = await manager.IsLockedOutAsync(user);
            var result = await signIn.CheckPasswordSignInAsync(user, request.Password, lockoutOnFailure: true);
            if (!result.Succeeded)
            {
                context.Items[ActivityAudit.LockedKey] = !wasLocked && result.IsLockedOut;
                context.Items[ActivityAudit.ReasonKey] = result.IsLockedOut ? "AccountLockedOut" : "InvalidCredentials";
                return InvalidCredentials();
            }
            // Checks credentials/lockout/confirmation without issuing a cookie.
            return Results.Ok(sessions.Issue(context, user, await manager.GetRolesAsync(user)));
        }).AllowAnonymous().RequireRateLimiting("password-auth");

        app.MapPut("/api/auth/me/password", async (SetPasswordRequest request, HttpContext context,
            UserManager<ChatUser> manager, SignInManager<ChatUser> signIn, ChatAppDbContext db) =>
        {
            NoCache(context);
            var user = await manager.GetUserAsync(context.User);
            if (user is null || !user.IsEnabled) return Results.Unauthorized();
            if (!user.AllowPasswordAuthentication || await manager.GetTwoFactorEnabledAsync(user)) return Results.Forbid();
            if (string.IsNullOrEmpty(request.NewPassword) || request.NewPassword.Length > 1024)
                return Results.BadRequest(new { error = "A new password of at most 1024 characters is required." });
            IdentityResult result;
            if (await manager.HasPasswordAsync(user))
            {
                if (string.IsNullOrEmpty(request.CurrentPassword) || request.CurrentPassword.Length > 1024)
                    return InvalidCredentials();
                var wasLocked = await manager.IsLockedOutAsync(user);
                var check = await signIn.CheckPasswordSignInAsync(user, request.CurrentPassword, lockoutOnFailure: true);
                if (!check.Succeeded)
                {
                    ActivityAudit.Add(db, "LoginFailed", user, context.User, new { provider = "Password", reason = "CurrentPasswordRejected" });
                    if (!wasLocked && check.IsLockedOut) ActivityAudit.Add(db, "UserLockedOut", user, context.User);
                    await db.SaveChangesAsync();
                    return InvalidCredentials();
                }
            }
            // Commit the password change before invalidating the client session.
            await using var transaction = await db.Database.BeginTransactionAsync();
            if (await manager.HasPasswordAsync(user))
            {
                result = await manager.ChangePasswordAsync(user, request.CurrentPassword!, request.NewPassword);
            }
            else result = await manager.AddPasswordAsync(user, request.NewPassword);
            if (result.Succeeded)
            {
                ActivityAudit.Add(db, "PasswordChanged", user, context.User, new { reason = "SelfService" });
                await db.SaveChangesAsync();
                await transaction.CommitAsync();
            }
            // Identity rotates the security stamp, invalidating existing JWTs.
            return result.Succeeded ? Results.NoContent()
                : Results.BadRequest(new { error = string.Join(" ", result.Errors.Select(x => x.Description)) });
        }).RequireAuthorization().RequireRateLimiting("password-auth");
    }

    private static IResult InvalidCredentials() => Results.Json(
        new { error = "Invalid username or password." }, statusCode: StatusCodes.Status401Unauthorized);

    private static void NoCache(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.Pragma = "no-cache";
    }

    public sealed record PasswordLoginRequest(string? Username, string? Password);
    public sealed record SetPasswordRequest(string? CurrentPassword, string? NewPassword);
}

// Administrator approval permits password login without falsely marking the email verified.
public sealed class PasswordAccountConfirmation : IUserConfirmation<ChatUser>
{
    public Task<bool> IsConfirmedAsync(UserManager<ChatUser> manager, ChatUser user) =>
        Task.FromResult(user.EmailConfirmed || user.AllowPasswordAuthentication);
}
