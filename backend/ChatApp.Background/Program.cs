using ChatApp.Background;
using ChatApp.Application.Data;
using ChatApp.Application.Handlers;
using Microsoft.EntityFrameworkCore;

var builder = Host.CreateApplicationBuilder(args);
var messagingSection = builder.Configuration.GetSection(
    MessagingOptions.SectionName);
var messagingProvider = messagingSection.GetValue<string>("Provider")?.Trim();
builder.Services.AddOptions<MessagingOptions>()
    .Bind(messagingSection)
    .Validate(
        options =>
            !string.Equals(
                options.Provider,
                "AzureServiceBus",
                StringComparison.OrdinalIgnoreCase) ||
            options.AzureServiceBus.IsValid(),
        "Azure Service Bus messaging configuration is incomplete.")
    .ValidateOnStart();
if (string.Equals(
        messagingProvider,
        "AzureServiceBus",
        StringComparison.OrdinalIgnoreCase))
{
    builder.Services.AddDbContext<ChatDbContext>(options =>
        options.UseSqlServer(
            builder.Configuration.GetConnectionString("ChatDatabase")));
    builder.Services.AddSingleton(serviceProvider =>
        serviceProvider
            .GetRequiredService<Microsoft.Extensions.Options.IOptions<
                MessagingOptions>>()
            .Value.AzureServiceBus.CreateClient());
    builder.Services.AddHttpClient<RecordingFileStatusUpdatedHandler>(client =>
    {
        var baseUrl = builder.Configuration["Api:BaseUrl"] ??
            "http://localhost:5045";
        client.BaseAddress = new Uri(baseUrl, UriKind.Absolute);
    });
    builder.Services.AddSingleton<RecordingFileStatusUpdatedWorker>();
    builder.Services.AddHostedService(serviceProvider =>
        serviceProvider.GetRequiredService<RecordingFileStatusUpdatedWorker>());
}

var host = builder.Build();
await host.RunAsync();
