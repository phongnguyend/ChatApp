namespace ChatApp.Api.Services;

public sealed class CallingOptions
{
    public const string SectionName = "Calling";

    public string Provider { get; set; } = "";

    public AzureCommunicationServicesOptions AzureCommunicationServices { get; set; } =
        new();
}

public sealed class AzureCommunicationServicesOptions
{
    public string ConnectionString { get; set; } = "";
    public string EventGridWebhookSecret { get; set; } = "";
}
