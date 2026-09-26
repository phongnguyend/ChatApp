namespace ChatApp.Infrastructure.Calling;

public sealed class CallingOptions
{
    public const string SectionName = "Calling";

    public string Provider { get; set; } = "AzureCommunicationServices";

    public AzureCommunicationServicesOptions AzureCommunicationServices { get; set; } =
        new();
}

public sealed class AzureCommunicationServicesOptions
{
    public string ConnectionString { get; set; } = "";
}
