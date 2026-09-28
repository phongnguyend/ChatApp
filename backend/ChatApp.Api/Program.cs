using ChatApp.Api;
using ChatApp.Api.Endpoints;
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
app.Use(async (context, next) =>
{
    var limit = context.GetEndpoint()?.Metadata.GetMetadata<Microsoft.AspNetCore.Http.Metadata.IRequestSizeLimitMetadata>();
    if (limit?.MaxRequestBodySize is long maxSize && context.Request.ContentLength > maxSize)
    {
        context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
        return;
    }
    var bodySize = context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
    if (limit is not null && bodySize is { IsReadOnly: false }) bodySize.MaxRequestBodySize = limit.MaxRequestBodySize;
    await next(context);
});
app.MapPasswordSignIn();
app.MapAccounts();
app.MapActivityLog();
if (!string.IsNullOrWhiteSpace(builder.Configuration["Authentication:Google:ClientId"])) app.MapGoogleSignIn();
if (!string.IsNullOrWhiteSpace(builder.Configuration["Authentication:Microsoft:ClientId"])) app.MapMicrosoftSignIn();
app.MapApplicationEndpoints();
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
