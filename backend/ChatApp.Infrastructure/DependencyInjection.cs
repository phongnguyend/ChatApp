using ChatApp.Application.Abstractions;
using ChatApp.Application.Handlers;
using ChatApp.Infrastructure.Calling;
using ChatApp.Infrastructure.Notification;
using ChatApp.Infrastructure.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace ChatApp.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var uploadStorageSection = configuration.GetSection(
            UploadStorageOptions.SectionName);
        var uploadStorageProvider =
            uploadStorageSection.GetValue<string>("Provider") ?? "Local";
        var callingSection = configuration.GetSection(
            CallingOptions.SectionName);

        services.AddOptions<UploadStorageOptions>()
            .Bind(uploadStorageSection)
            .Validate(
                options =>
                    !options.Provider.Equals("Local", StringComparison.OrdinalIgnoreCase) ||
                    !string.IsNullOrWhiteSpace(options.Path),
                "UploadStorage:Path must not be empty.")
            .ValidateOnStart();
        services.AddOptions<AzureBlobOptions>()
            .Bind(uploadStorageSection.GetSection("AzureBlob"))
            .Validate(
                options =>
                    !uploadStorageProvider.Equals(
                        "AzureBlob",
                        StringComparison.OrdinalIgnoreCase) ||
                    options.IsValid(),
                "Azure Blob storage configuration is incomplete.")
            .ValidateOnStart();
        services.Configure<NotificationOptions>(
            configuration.GetSection(NotificationOptions.SectionName));
        services.AddOptions<CallingOptions>()
            .Bind(callingSection)
            .Validate(
                options =>
                    string.Equals(
                        options.Provider,
                        "AzureCommunicationServices",
                        StringComparison.OrdinalIgnoreCase) &&
                    !string.IsNullOrWhiteSpace(
                        options.AzureCommunicationServices.ConnectionString),
                "Calling must use Azure Communication Services with a connection string.")
            .ValidateOnStart();
        services.AddScoped<
            ICallingProvider,
            AzureCommunicationServicesCallingProvider>();
        if (uploadStorageProvider.Equals(
            "AzureBlob",
            StringComparison.OrdinalIgnoreCase))
        {
            services.AddSingleton<
                IUploadObjectStorage,
                AzureBlobUploadObjectStorage>();
        }
        else if (uploadStorageProvider.Equals(
            "Local",
            StringComparison.OrdinalIgnoreCase))
        {
            services.AddSingleton<IUploadObjectStorage, LocalUploadObjectStorage>();
        }
        else
        {
            throw new InvalidOperationException(
                $"Unsupported upload storage provider \"{uploadStorageProvider}\".");
        }
        services.AddScoped<AzurePushNotificationService>();
        return services;
    }

    public static IServiceCollection AddRecordingProcessing(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddHttpClient<RecordingFileStatusUpdatedHandler>(client =>
        {
            var baseUrl = configuration["Api:BaseUrl"] ?? "http://localhost:5045";
            client.BaseAddress = new Uri(baseUrl, UriKind.Absolute);
            var callbackKey = configuration["RecordingCallbacks:Key"];
            if (!string.IsNullOrWhiteSpace(callbackKey)) client.DefaultRequestHeaders.Add("X-Recording-Callback-Key", callbackKey);
        });
        return services;
    }
}
