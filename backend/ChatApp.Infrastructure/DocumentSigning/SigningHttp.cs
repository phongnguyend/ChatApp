using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace ChatApp.Infrastructure.DocumentSigning;

internal static class SigningHttp
{
    public static async Task<JsonElement> JsonAsync(HttpClient http, HttpMethod method, string url, string? token, HttpContent? content, CancellationToken ct, string? operation = null)
    {
        using var response = await SendAsync(http, method, url, token, content, ct, operation);
        using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        return json.RootElement.Clone();
    }

    public static async Task<HttpResponseMessage> SendAsync(HttpClient http, HttpMethod method, string url, string? token, HttpContent? content, CancellationToken ct, string? operation = null)
    {
        using var request = new HttpRequestMessage(method, url) { Content = content };
        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            var status = response.StatusCode;
            string? code = null;
            using (response)
            {
                try
                {
                    using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
                    if (body.RootElement.ValueKind == JsonValueKind.Object &&
                        body.RootElement.TryGetProperty("code", out var value) && value.ValueKind == JsonValueKind.String &&
                        value.GetString() is { } candidate &&
                        new[] { "PERMISSION_DENIED", "UNAUTHORIZED", "INVALID_ACCESS_TOKEN", "INVALID_API_ACCESS_POINT", "API_ACCESS_DENIED", "ACTION_NOT_ALLOWED", "USER_NOT_ENABLED", "ACCOUNT_NOT_ENABLED" }.Contains(candidate))
                    {
                        code = candidate;
                    }
                }
                catch (JsonException)
                {
                    // HTML and other non-JSON error responses must not mask the HTTP failure.
                }
            }
            // Only expose recognized codes, never provider messages, URLs, or credentials.
            var step = operation is null ? "Signing provider" : operation;
            var detail = code is null ? "" : $" ({code})";
            throw new HttpRequestException($"{step} returned HTTP {(int)status}{detail}. Check the shared account configuration and provider request status before retrying.", null, status);
        }
        return response;
    }

    public static string PreparationUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
            !new[] { "docusign.net", "docusign.com", "adobesign.com", "echosign.com" }
                .Any(domain => uri.Host == domain || uri.Host.EndsWith("." + domain, StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException("The provider did not return a trusted preparation URL.");
        }
        return url;
    }
}
