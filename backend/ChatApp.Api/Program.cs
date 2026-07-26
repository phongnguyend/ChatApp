using ChatApp.Api.Data;
using ChatApp.Api.Hubs;
using ChatApp.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
var avatarUploadPath = Path.Combine(
    builder.Environment.ContentRootPath,
    "wwwroot",
    "uploads",
    "avatars");
Directory.CreateDirectory(avatarUploadPath);

builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.AddHttpClient();
builder.Services.AddDbContext<ChatDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("ChatDatabase")));
builder.Services.Configure<AzureNotificationOptions>(
    builder.Configuration.GetSection(AzureNotificationOptions.SectionName));
builder.Services.AddSingleton<PresenceTracker>();
builder.Services.AddScoped<AvatarStorage>();
builder.Services.AddScoped<MessageAttachmentStorage>();
builder.Services.AddScoped<AzurePushNotificationService>();

var allowedOrigins = builder.Configuration
    .GetSection("AllowedOrigins")
    .Get<string[]>() ?? ["http://localhost:5173"];

builder.Services.AddCors(options =>
{
    options.AddPolicy("ReactApp", policy =>
        policy.WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials());
});

var app = builder.Build();

app.UseStaticFiles();
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(avatarUploadPath),
    RequestPath = "/uploads/avatars"
});
app.UseCors("ReactApp");
app.MapControllers();
app.MapHub<ChatHub>("/hubs/chat");
app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ChatDbContext>();
    await DatabaseInitializer.InitializeAsync(db);
}

app.Run();

public partial class Program;
