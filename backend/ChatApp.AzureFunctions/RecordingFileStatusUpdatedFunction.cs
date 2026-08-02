using System.Text.Json;
using Azure.Messaging.ServiceBus;
using ChatApp.Application.Handlers;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace ChatApp.AzureFunctions;

public sealed class RecordingFileStatusUpdatedFunction(
    RecordingFileStatusUpdatedHandler handler,
    ILogger<RecordingFileStatusUpdatedFunction> logger)
{
    [Function(nameof(RecordingFileStatusUpdatedFunction))]
    public async Task Run(
        [ServiceBusTrigger(
            "%ServiceBusTopicName%",
            "%ServiceBusSubscriptionName%",
            Connection = "ServiceBusConnection",
            AutoCompleteMessages = false)]
        ServiceBusReceivedMessage message,
        ServiceBusMessageActions messageActions,
        CancellationToken cancellationToken)
    {
        try
        {
            var handled = await HandleMessageAsync(message, cancellationToken);
            if (handled)
            {
                await messageActions.CompleteMessageAsync(
                    message,
                    cancellationToken);
                return;
            }

            await messageActions.DeadLetterMessageAsync(
                message,
                deadLetterReason: "UnsupportedMessage",
                deadLetterErrorDescription:
                    "The Service Bus message is not a supported recording event.",
                cancellationToken: cancellationToken);
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Service Bus recording message {MessageId} could not be processed.",
                message.MessageId);
            await messageActions.AbandonMessageAsync(
                message,
                cancellationToken: CancellationToken.None);
        }
    }

    private async Task<bool> HandleMessageAsync(
        ServiceBusReceivedMessage message,
        CancellationToken cancellationToken)
    {
        using var document = JsonDocument.Parse(message.Body.ToStream());
        if (document.RootElement.ValueKind == JsonValueKind.Array)
        {
            var handled = false;
            foreach (var eventGridEvent in document.RootElement.EnumerateArray())
            {
                handled = await handler.HandleAsync(
                    eventGridEvent,
                    cancellationToken) || handled;
            }
            return handled;
        }
        return document.RootElement.ValueKind == JsonValueKind.Object &&
            await handler.HandleAsync(document.RootElement, cancellationToken);
    }
}
