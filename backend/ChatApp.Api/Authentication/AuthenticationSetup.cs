using System.Security.Claims;
using ChatApp.Domain.Security;
using ChatApp.Persistence;
using ChatApp.Domain.Models;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;

namespace ChatApp.Api.Authentication;

public static class AuthenticationSetup
{
    public static void AddAccountAuthentication(this WebApplicationBuilder builder)
    {
        builder.Services.AddIdentity<ChatUser, IdentityRole<Guid>>(options =>
        {
            // Legacy chat handles may contain spaces and have no email until an admin assigns one.
            options.User.AllowedUserNameCharacters = "";
            options.SignIn.RequireConfirmedAccount = true;
            options.Password.RequiredLength = 12;
            options.Lockout.MaxFailedAccessAttempts = 5;
            options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        }).AddEntityFrameworkStores<ChatAppDbContext>().AddDefaultTokenProviders();
        builder.Services.AddScoped<IUserConfirmation<ChatUser>, PasswordAccountConfirmation>();
        var sessions = new JwtSessionService(builder.Configuration);
        builder.Services.AddSingleton(sessions);
        builder.Services.AddAuthentication(options =>
        {
            options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
            options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
            options.DefaultForbidScheme = JwtBearerDefaults.AuthenticationScheme;
        }).AddJwtBearer(options =>
        {
            options.MapInboundClaims = false;
            options.TokenValidationParameters = sessions.ValidationParameters;
            options.Events = new JwtBearerEvents
            {
                OnMessageReceived = context =>
                {
                    if (context.Request.Path.StartsWithSegments("/hubs/chat"))
                        context.Token = context.Request.Query["access_token"];
                    // Browser media elements cannot supply an Authorization header. The cookie
                    // is accepted only for read-only media, never for API mutations or sessions.
                    else if (HttpMethods.IsGet(context.Request.Method) &&
                        (context.Request.Path.StartsWithSegments("/api/attachments") ||
                         context.Request.Path.StartsWithSegments("/api/avatars") ||
                         (context.Request.Path.StartsWithSegments("/api/documents") &&
                          (context.Request.Path.Value!.EndsWith("/content") || context.Request.Path.Value.EndsWith("/qr-code")))))
                        context.Token = context.Request.Headers.Authorization.Count == 0
                            ? context.Request.Cookies["chatapp-media"] : null;
                    return Task.CompletedTask;
                },
                OnTokenValidated = async context =>
                {
                    if (!Guid.TryParse(context.Principal?.FindFirstValue("sub"), out var id))
                    { context.Fail("Invalid session."); return; }
                    var manager = context.HttpContext.RequestServices.GetRequiredService<UserManager<ChatUser>>();
                    var user = await manager.FindByIdAsync(id.ToString());
                    if (user is null || !user.IsEnabled || string.IsNullOrEmpty(user.SecurityStamp) ||
                        user.SecurityStamp != context.Principal?.FindFirstValue("security_stamp"))
                    { context.Fail("Session expired or revoked."); return; }
                    var chat = user;
                    if (chat.Status != "active") { context.Fail("Account unavailable."); return; }
                    var identity = (ClaimsIdentity)context.Principal!.Identity!;
                    foreach (var claim in identity.FindAll(ClaimTypes.NameIdentifier).Concat(identity.FindAll("role")).ToArray())
                        identity.RemoveClaim(claim);
                    identity.AddClaim(new Claim(ClaimTypes.NameIdentifier, id.ToString()));
                    identity.AddClaim(new Claim("chat_username", chat.UserName));
                    foreach (var role in await manager.GetRolesAsync(user)) identity.AddClaim(new Claim("role", role));
                }
            };
        });
        builder.AddGoogleSignIn();
        builder.AddMicrosoftSignIn();
        builder.Services.AddAuthorization(options =>
        {
            options.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
            options.AddPolicy(AppRoles.ManageUsers, policy => policy.RequireRole(AppRoles.GlobalAdmin));
        });
        builder.Services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddFixedWindowLimiter("password-auth", limiter =>
            {
                limiter.PermitLimit = 60; limiter.Window = TimeSpan.FromMinutes(1); limiter.QueueLimit = 0;
            });
        });
        builder.Services.AddSingleton<AuthenticatedHubFilter>();
        builder.Services.AddHostedService<SessionRevocationWorker>();
    }

    public static async Task InitializeRolesAsync(this IServiceProvider services)
    {
        var roles = services.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        foreach (var role in new[] { AppRoles.User, AppRoles.GlobalAdmin })
            if (!await roles.RoleExistsAsync(role)) Ensure(await roles.CreateAsync(new IdentityRole<Guid>(role)));
    }

    private static void Ensure(IdentityResult result)
    {
        if (!result.Succeeded) throw new InvalidOperationException(string.Join(" ", result.Errors.Select(x => x.Description)));
    }
}
