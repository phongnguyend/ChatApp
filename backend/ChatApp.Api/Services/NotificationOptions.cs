namespace ChatApp.Api.Services;

public sealed class NotificationOptions
{
    public const string SectionName = "Notification";

    public string Provider { get; init; } = "";

    public AzureNotificationHubOptions AzureNotificationHub { get; init; } = new();
}

public sealed class AzureNotificationHubOptions
{
    public string ConnectionString { get; init; } = "";
    public string HubName { get; init; } = "";
    public string VapidPublicKey { get; init; } = "";
    public string FrontendBaseUrl { get; init; } = "http://localhost:5173";

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ConnectionString) &&
        !string.IsNullOrWhiteSpace(HubName) &&
        !string.IsNullOrWhiteSpace(VapidPublicKey);
}
