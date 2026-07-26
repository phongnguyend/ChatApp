namespace ChatApp.Api.Services;

public sealed class AzureNotificationOptions
{
    public const string SectionName = "AzureNotifications";

    public string ConnectionString { get; init; } = "";
    public string HubName { get; init; } = "";
    public string VapidPublicKey { get; init; } = "";
    public string FrontendBaseUrl { get; init; } = "http://localhost:5173";

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(ConnectionString) &&
        !string.IsNullOrWhiteSpace(HubName) &&
        !string.IsNullOrWhiteSpace(VapidPublicKey);
}
