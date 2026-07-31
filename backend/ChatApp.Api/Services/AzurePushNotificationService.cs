using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ChatApp.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ChatApp.Api.Services;

public sealed class AzurePushNotificationService(
    ChatDbContext db,
    IHttpClientFactory httpClientFactory,
    IOptions<NotificationOptions> options,
    ILogger<AzurePushNotificationService> logger)
{
    private const string ApiVersion = "2020-06";
    private readonly AzureNotificationHubOptions _options = options.Value.AzureNotificationHub;

    public bool IsConfigured => _options.IsConfigured;
    public string VapidPublicKey => IsConfigured ? _options.VapidPublicKey : "";

    public async Task RegisterAsync(
        Guid userId,
        string installationId,
        string endpoint,
        string p256dh,
        string auth,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();
        var requestUri = BuildResourceUri(
            $"installations/{Uri.EscapeDataString(installationId)}");
        var payload = JsonSerializer.Serialize(new
        {
            installationId,
            userId = userId.ToString("N"),
            platform = "browser",
            pushChannel = new { endpoint, p256dh, auth },
            tags = new[] { UserTag(userId) },
            expirationTime = DateTimeOffset.UtcNow.AddDays(90)
        });

        using var request = CreateRequest(
            HttpMethod.Put,
            requestUri,
            payload);
        using var response = await httpClientFactory.CreateClient()
            .SendAsync(request, cancellationToken);
        await EnsureSuccess(response, "register the browser", cancellationToken);
    }

    public async Task UnregisterAsync(
        string installationId,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();
        var requestUri = BuildResourceUri(
            $"installations/{Uri.EscapeDataString(installationId)}");
        using var request = CreateRequest(
            HttpMethod.Delete,
            requestUri);
        using var response = await httpClientFactory.CreateClient()
            .SendAsync(request, cancellationToken);
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return;
        }
        await EnsureSuccess(response, "remove the browser", cancellationToken);
    }

    public async Task NotifyMessageAsync(
        Guid conversationId,
        Guid senderUserId,
        string senderDisplayName,
        string body,
        CancellationToken cancellationToken)
    {
        try
        {
            await NotifyMessageCoreAsync(
                conversationId,
                senderUserId,
                senderDisplayName,
                body,
                cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // A disconnected sender must not turn an already-committed message into an error.
        }
        catch (Exception exception)
        {
            logger.LogWarning(
                exception,
                "Could not dispatch push notifications for conversation {ConversationId}.",
                conversationId);
        }
    }

    private async Task NotifyMessageCoreAsync(
        Guid conversationId,
        Guid senderUserId,
        string senderDisplayName,
        string body,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            return;
        }
        var now = DateTimeOffset.UtcNow;
        var conversation = await db.Conversations
            .AsNoTracking()
            .Where(item => item.Id == conversationId)
            .Select(item => new { item.Type, item.Title })
            .SingleOrDefaultAsync(cancellationToken);
        if (conversation is null)
        {
            return;
        }

        var recipientIds = await db.ConversationMembers
            .AsNoTracking()
            .Where(member =>
                member.ConversationId == conversationId &&
                member.UserId != senderUserId &&
                member.LeftAt == null &&
                (member.MutedUntil == null || member.MutedUntil <= now))
            .Select(member => member.UserId)
            .ToListAsync(cancellationToken);
        if (recipientIds.Count == 0)
        {
            return;
        }

        var title = conversation.Type == "group"
            ? $"#{conversation.Title ?? "Group"} · {senderDisplayName}"
            : senderDisplayName;
        var baseUrl = _options.FrontendBaseUrl.TrimEnd('/');
        var payload = JsonSerializer.Serialize(new
        {
            title,
            body = Truncate(body, 180),
            tag = $"conversation-{conversationId:N}",
            url = $"{baseUrl}/?conversation={conversationId:D}",
            conversationId
        });

        foreach (var recipientId in recipientIds)
        {
            try
            {
                await SendToTagAsync(
                    UserTag(recipientId),
                    payload,
                    cancellationToken);
            }
            catch (Exception exception) when (
                exception is HttpRequestException or TaskCanceledException)
            {
                logger.LogWarning(
                    exception,
                    "Could not send a push notification for conversation {ConversationId}.",
                    conversationId);
            }
        }
    }

    private async Task SendToTagAsync(
        string tag,
        string payload,
        CancellationToken cancellationToken)
    {
        var requestUri = BuildResourceUri("messages/");
        using var request = CreateRequest(
            HttpMethod.Post,
            requestUri,
            payload);
        request.Headers.TryAddWithoutValidation(
            "ServiceBusNotification-Format",
            "browser");
        request.Headers.TryAddWithoutValidation(
            "ServiceBusNotification-Tags",
            tag);
        using var response = await httpClientFactory.CreateClient()
            .SendAsync(request, cancellationToken);
        await EnsureSuccess(response, "send the notification", cancellationToken);
    }

    private HttpRequestMessage CreateRequest(
        HttpMethod method,
        Uri requestUri,
        string? json = null)
    {
        var request = new HttpRequestMessage(method, requestUri);
        request.Headers.TryAddWithoutValidation(
            "Authorization",
            CreateSharedAccessSignature());
        request.Headers.TryAddWithoutValidation("x-ms-version", ApiVersion);
        if (json is not null)
        {
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
            request.Content.Headers.ContentType =
                new MediaTypeHeaderValue("application/json")
                {
                    CharSet = "utf-8"
                };
        }
        return request;
    }

    private Uri BuildResourceUri(string relativePath, string? queryFlag = null)
    {
        var endpoint = GetNamespaceEndpoint().TrimEnd('/');
        var hubName = Uri.EscapeDataString(_options.HubName.Trim());
        var query = queryFlag is null
            ? $"api-version={ApiVersion}"
            : $"api-version={ApiVersion}&{queryFlag}";
        var uri = $"{endpoint}/{hubName}/{relativePath}?{query}";
        return new Uri(uri);
    }

    private string CreateSharedAccessSignature()
    {
        var connection = ParseConnectionString();
        // Match the Azure Notification Hubs SDK: tokens authorize the
        // namespace endpoint while the request URI identifies the hub resource.
        var resourceUri = GetNamespaceEndpoint().ToLowerInvariant();
        var encodedResourceUri = Uri.EscapeDataString(resourceUri);
        var expiry = DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds();
        var stringToSign = $"{encodedResourceUri}\n{expiry}";
        // SharedAccessKey is Base64-looking text, but Service Bus SAS signing
        // uses the literal UTF-8 value from the connection string as the HMAC
        // key. Decoding it first produces a token Azure will always reject.
        using var hmac = new HMACSHA256(
            Encoding.UTF8.GetBytes(connection["SharedAccessKey"]));
        var signature = Convert.ToBase64String(
            hmac.ComputeHash(Encoding.UTF8.GetBytes(stringToSign)));

        return $"SharedAccessSignature sr={encodedResourceUri}" +
               $"&sig={Uri.EscapeDataString(signature)}" +
               $"&se={expiry}" +
               $"&skn={Uri.EscapeDataString(connection["SharedAccessKeyName"])}";
    }

    private string GetNamespaceEndpoint()
    {
        var endpoint = ParseConnectionString()["Endpoint"]
            .Replace("sb://", "https://", StringComparison.OrdinalIgnoreCase);
        return endpoint.EndsWith('/') ? endpoint : $"{endpoint}/";
    }

    private Dictionary<string, string> ParseConnectionString()
    {
        var values = _options.ConnectionString
            .Split(';', StringSplitOptions.RemoveEmptyEntries)
            .Select(segment => segment.Split('=', 2))
            .Where(parts => parts.Length == 2)
            .ToDictionary(
                parts => parts[0].Trim(),
                parts => parts[1].Trim(),
                StringComparer.OrdinalIgnoreCase);
        foreach (var key in new[] { "Endpoint", "SharedAccessKeyName", "SharedAccessKey" })
        {
            if (!values.ContainsKey(key))
            {
                throw new InvalidOperationException(
                    $"Notification:AzureNotificationHub:ConnectionString is missing {key}.");
            }
        }
        return values;
    }

    private void EnsureConfigured()
    {
        if (!IsConfigured)
        {
            throw new InvalidOperationException(
                "Azure browser notifications are not configured.");
        }
    }

    private static async Task EnsureSuccess(
        HttpResponseMessage response,
        string action,
        CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
        throw new HttpRequestException(
            $"Azure Notification Hubs could not {action} " +
            $"({(int)response.StatusCode}): {Truncate(responseBody, 400)}");
    }

    private static string UserTag(Guid userId) => $"user_{userId:N}";

    private static string Truncate(string value, int maxLength) =>
        value.Length <= maxLength ? value : $"{value[..(maxLength - 1)]}…";
}
