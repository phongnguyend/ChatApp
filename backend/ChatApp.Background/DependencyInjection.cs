using ChatApp.Infrastructure;
using ChatApp.Infrastructure.Messaging;
using ChatApp.Persistence;

namespace ChatApp.Background;

public static class DependencyInjection
{
    public static IServiceCollection AddBackground(this IServiceCollection services, IConfiguration configuration)
    {
        var messagingSection = configuration.GetSection(
            MessagingOptions.SectionName);
        var messagingProvider = messagingSection.GetValue<string>("Provider")?.Trim();
        services.AddOptions<MessagingOptions>()
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
            services.AddPersistence(configuration);
            services.AddSingleton(serviceProvider =>
                serviceProvider
                    .GetRequiredService<Microsoft.Extensions.Options.IOptions<
                        MessagingOptions>>()
                    .Value.AzureServiceBus.CreateClient());
            services.AddRecordingProcessing(configuration);
            services.AddSingleton<RecordingFileStatusUpdatedWorker>();
            services.AddHostedService(serviceProvider =>
                serviceProvider.GetRequiredService<RecordingFileStatusUpdatedWorker>());
        }
        return services;
    }
}
