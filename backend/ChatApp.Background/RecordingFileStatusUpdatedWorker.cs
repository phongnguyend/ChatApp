using System.Text.Json;
using Azure.Messaging.ServiceBus;
using ChatApp.Application.Handlers;
using Microsoft.Extensions.Options;

namespace ChatApp.Background;

public sealed class RecordingFileStatusUpdatedWorker(
    ServiceBusClient client,
    IOptions<MessagingOptions> options,
    IServiceScopeFactory scopeFactory,
    ILogger<RecordingFileStatusUpdatedWorker> logger) : BackgroundService
{
    private ServiceBusProcessor? processor;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var serviceBus = options.Value.AzureServiceBus;
        processor = client.CreateProcessor(
            serviceBus.TopicName,
            serviceBus.SubscriptionName,
            new ServiceBusProcessorOptions
            {
                AutoCompleteMessages = false,
                MaxAutoLockRenewalDuration = TimeSpan.FromHours(1),
                MaxConcurrentCalls = 1
            });
        processor.ProcessMessageAsync += ProcessMessageAsync;
        processor.ProcessErrorAsync += ProcessErrorAsync;
        await processor.StartProcessingAsync(stoppingToken);
        try
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        finally
        {
            await processor.StopProcessingAsync(CancellationToken.None);
            await processor.DisposeAsync();
            processor = null;
        }
    }

    private async Task ProcessMessageAsync(ProcessMessageEventArgs args)
    {
        try
        {
            var handled = await HandleEventGridEventsAsync(args.Message);
            if (handled)
            {
                await args.CompleteMessageAsync(args.Message);
            }
            else
            {
                await args.DeadLetterMessageAsync(
                    args.Message,
                    "UnsupportedMessage",
                    "The Service Bus message is not a supported recording event.");
            }
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Service Bus recording message {MessageId} could not be processed.",
                args.Message.MessageId);
            await args.AbandonMessageAsync(args.Message);
        }
    }

    private async Task<bool> HandleEventGridEventsAsync(
        ServiceBusReceivedMessage message)
    {
        using var document = JsonDocument.Parse(message.Body.ToStream());
        await using var scope = scopeFactory.CreateAsyncScope();
        var handler = scope.ServiceProvider
            .GetRequiredService<RecordingFileStatusUpdatedHandler>();
        if (document.RootElement.ValueKind == JsonValueKind.Array)
        {
            var handled = false;
            foreach (var eventGridEvent in document.RootElement.EnumerateArray())
            {
                handled = await handler.HandleAsync(eventGridEvent) || handled;
            }
            return handled;
        }
        return document.RootElement.ValueKind == JsonValueKind.Object &&
            await handler.HandleAsync(document.RootElement);
    }

    private Task ProcessErrorAsync(ProcessErrorEventArgs args)
    {
        logger.LogError(
            args.Exception,
            "Azure Service Bus recording processor failed in {ErrorSource} for {EntityPath}.",
            args.ErrorSource,
            args.EntityPath);
        return Task.CompletedTask;
    }
}
