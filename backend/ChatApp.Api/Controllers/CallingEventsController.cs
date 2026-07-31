using System.Text.Json;
using ChatApp.Api.Data;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/calling/events")]
public sealed class CallingEventsController(
    ChatDbContext db,
    IOptions<CallingOptions> options,
    IServiceProvider services) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Receive(
        [FromQuery] string? secret,
        JsonElement events,
        CancellationToken cancellationToken)
    {
        var finalizations =
            services.GetService<CallingProviderRecordingFinalizationQueue>();
        if (finalizations is null)
        {
            return NotFound();
        }
        var configuredSecret =
            options.Value.AzureCommunicationServices.EventGridWebhookSecret;
        if (!string.IsNullOrWhiteSpace(configuredSecret) &&
            !string.Equals(
                configuredSecret,
                secret,
                StringComparison.Ordinal))
        {
            return Unauthorized();
        }
        if (events.ValueKind != JsonValueKind.Array)
        {
            return BadRequest();
        }

        foreach (var cloudEvent in events.EnumerateArray())
        {
            var eventType = cloudEvent.TryGetProperty(
                "eventType",
                out var eventTypeElement)
                ? eventTypeElement.GetString()
                : null;
            if (eventType ==
                "Microsoft.EventGrid.SubscriptionValidationEvent")
            {
                var validationCode = cloudEvent
                    .GetProperty("data")
                    .GetProperty("validationCode")
                    .GetString();
                return Ok(new { validationResponse = validationCode });
            }
            if (eventType !=
                "Microsoft.Communication.RecordingFileStatusUpdated")
            {
                continue;
            }

            var subject = cloudEvent.GetProperty("subject").GetString() ?? "";
            var providerRecordingId = RecordingIdFromSubject(subject);
            if (string.IsNullOrWhiteSpace(providerRecordingId))
            {
                continue;
            }
            var data = cloudEvent.GetProperty("data");
            var duration = data.TryGetProperty(
                "recordingDurationMs",
                out var durationElement)
                ? durationElement.GetInt64()
                : 0;
            var locations = data
                .GetProperty("recordingStorageInfo")
                .GetProperty("recordingChunks")
                .EnumerateArray()
                .OrderBy(chunk => chunk.GetProperty("index").GetInt32())
                .Select(chunk => chunk.GetProperty("contentLocation").GetString())
                .Where(location => Uri.TryCreate(
                    location,
                    UriKind.Absolute,
                    out _))
                .Select(location => new Uri(location!))
                .ToArray();
            if (locations.Length > 0)
            {
                var recording = await db.SessionRecordings.SingleOrDefaultAsync(
                    item =>
                        item.ProviderRecordingId == providerRecordingId &&
                        item.Status != "completed",
                    cancellationToken);
                if (recording is null)
                {
                    continue;
                }
                recording.ProviderContentLocationsJson =
                    JsonSerializer.Serialize(
                        locations.Select(location => location.AbsoluteUri));
                if (duration > 0)
                {
                    recording.DurationMilliseconds = duration;
                }
                await db.SaveChangesAsync(cancellationToken);
                await finalizations.EnqueueAsync(
                    new CallingProviderRecordingFile(
                        providerRecordingId,
                        locations,
                        duration),
                    cancellationToken);
            }
        }

        return Ok();
    }

    private static string? RecordingIdFromSubject(string subject)
    {
        const string segment = "/recordingId/";
        var start = subject.LastIndexOf(
            segment,
            StringComparison.OrdinalIgnoreCase);
        return start < 0
            ? null
            : subject[(start + segment.Length)..].Split('/')[0];
    }
}
