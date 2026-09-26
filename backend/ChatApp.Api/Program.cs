using ChatApp.Api;
using ChatApp.Api.Authentication;
using ChatApp.Api.Hubs;
using ChatApp.Persistence;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddApi(builder.Configuration);
builder.AddAccountAuthentication();

var app = builder.Build();

// Return safe error responses in every environment, including local development.
app.UseExceptionHandler(handler => handler.Run(async context =>
{
    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
    await Results.Problem(title: "Request failed", detail: "The service is temporarily unavailable. Please try again shortly.",
        statusCode: StatusCodes.Status500InternalServerError).ExecuteAsync(context);
}));
app.UseCors("ReactApp");
app.UseLoginAudit();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.MapPasswordSignIn();
app.MapAccounts();
app.MapActivityLog();
if (!string.IsNullOrWhiteSpace(builder.Configuration["Authentication:Google:ClientId"])) app.MapGoogleSignIn();
if (!string.IsNullOrWhiteSpace(builder.Configuration["Authentication:Microsoft:ClientId"])) app.MapMicrosoftSignIn();
app.MapControllers();
app.MapHub<ChatHub>("/hubs/chat", options => options.CloseOnAuthenticationExpiration = true).RequireAuthorization();
app.MapGet("/health", () => Results.Ok(new { status = "healthy" })).AllowAnonymous();

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ChatAppDbContext>();
    await DatabaseInitializer.InitializeAsync(db);
    await scope.ServiceProvider.InitializeRolesAsync();
}

app.Run();

public partial class Program;
