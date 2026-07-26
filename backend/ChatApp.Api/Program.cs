using ChatApp.Api.Data;
using ChatApp.Api.Hubs;
using ChatApp.Api.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.AddHttpClient();
builder.Services.AddDbContext<ChatDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("ChatDatabase")));
builder.Services.AddOptions<UploadStorageOptions>()
    .Bind(builder.Configuration.GetSection(UploadStorageOptions.SectionName))
    .Validate(
        options => !string.IsNullOrWhiteSpace(options.Path),
        "UploadStorage:Path must not be empty.")
    .ValidateOnStart();
builder.Services.Configure<AzureNotificationOptions>(
    builder.Configuration.GetSection(AzureNotificationOptions.SectionName));
builder.Services.AddSingleton<PresenceTracker>();
builder.Services.AddSingleton<IUploadObjectStorage, LocalUploadObjectStorage>();
builder.Services.AddScoped<IAvatarStorage, AvatarStorage>();
builder.Services.AddScoped<IMessageAttachmentStorage, MessageAttachmentStorage>();
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
