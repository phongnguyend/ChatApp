using ChatApp.Api.Data;
using ChatApp.Api.Hubs;
using ChatApp.Api.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var uploadStorageSection = builder.Configuration.GetSection(
    UploadStorageOptions.SectionName);
var uploadStorageProvider =
    uploadStorageSection.GetValue<string>("Provider") ?? "Local";

builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.AddHttpClient();
builder.Services.AddDbContext<ChatDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("ChatDatabase")));
builder.Services.AddOptions<UploadStorageOptions>()
    .Bind(uploadStorageSection)
    .Validate(
        options =>
            !options.Provider.Equals("Local", StringComparison.OrdinalIgnoreCase) ||
            !string.IsNullOrWhiteSpace(options.Path),
        "UploadStorage:Path must not be empty.")
    .ValidateOnStart();
builder.Services.AddOptions<AzureBlobOptions>()
    .Bind(uploadStorageSection.GetSection("AzureBlob"))
    .Validate(
        options =>
            !uploadStorageProvider.Equals(
                "AzureBlob",
                StringComparison.OrdinalIgnoreCase) ||
            options.IsValid(),
        "Azure Blob storage configuration is incomplete.")
    .ValidateOnStart();
builder.Services.Configure<AzureNotificationOptions>(
    builder.Configuration.GetSection(AzureNotificationOptions.SectionName));
builder.Services.AddSingleton<PresenceTracker>();
if (uploadStorageProvider.Equals(
    "AzureBlob",
    StringComparison.OrdinalIgnoreCase))
{
    builder.Services.AddSingleton<
        IUploadObjectStorage,
        AzureBlobUploadObjectStorage>();
}
else if (uploadStorageProvider.Equals(
    "Local",
    StringComparison.OrdinalIgnoreCase))
{
    builder.Services.AddSingleton<IUploadObjectStorage, LocalUploadObjectStorage>();
}
else
{
    throw new InvalidOperationException(
        $"Unsupported upload storage provider \"{uploadStorageProvider}\".");
}
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
