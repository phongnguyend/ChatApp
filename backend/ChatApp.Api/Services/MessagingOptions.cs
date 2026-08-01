using Azure.Identity;
using Azure.Messaging.ServiceBus;

namespace ChatApp.Api.Services;

public sealed class MessagingOptions
{
    public const string SectionName = "Messaging";

    public string Provider { get; set; } = "";

    public AzureServiceBusOptions AzureServiceBus { get; set; } = new();
}

public sealed class AzureServiceBusOptions
{
    public bool UseManagedIdentity { get; set; }
    public string ConnectionString { get; set; } = "";
    public string FullyQualifiedNamespace { get; set; } = "";
    public string TopicName { get; set; } = "chatapp-messages";
    public string SubscriptionName { get; set; } = "chatapp-messages-sub";

    public bool IsValid() =>
        !string.IsNullOrWhiteSpace(TopicName) &&
        !string.IsNullOrWhiteSpace(SubscriptionName) &&
        (UseManagedIdentity
            ? !string.IsNullOrWhiteSpace(FullyQualifiedNamespace)
            : !string.IsNullOrWhiteSpace(ConnectionString));

    public ServiceBusClient CreateClient() => UseManagedIdentity
        ? new ServiceBusClient(
            FullyQualifiedNamespace,
            new DefaultAzureCredential())
        : new ServiceBusClient(ConnectionString);
}
