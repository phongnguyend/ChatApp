using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Caching.Memory;
using ChatApp.Application;

namespace ChatApp.Infrastructure.DocumentSigning;

public sealed class AdobeSignService(HttpClient http, IOptions<DocumentSigningOptions> options, IMemoryCache tokenCache) : ISignatureProvider
{
    private readonly AdobeSignOptions settings = options.Value.AdobeSign;

    public string Name => "AdobeSign";

    public bool Enabled => settings.Enabled;

    private string Root => settings.ApiAccessPoint.TrimEnd('/') + "/api/rest/v6";

    private async Task<string> TokenAsync(CancellationToken ct)
    {
        var cacheKey = ("Signing.AdobeSign", settings.ApiAccessPoint, settings.ClientId);
        if (tokenCache.TryGetValue<string>(cacheKey, out var cached) && cached is not null)
        {
            return cached;
        }
        var result = await SigningHttp.JsonAsync(http, HttpMethod.Post, settings.ApiAccessPoint.TrimEnd('/') + "/oauth/v2/refresh", null,
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "refresh_token",
                ["client_id"] = settings.ClientId,
                ["client_secret"] = settings.ClientSecret,
                ["refresh_token"] = settings.RefreshToken
            }), ct, "Adobe Sign token refresh");
        var token = result.GetProperty("access_token").GetString()!;
        tokenCache.Set(cacheKey, token, TimeSpan.FromSeconds(result.TryGetProperty("expires_in", out var expiry) ? Math.Max(1, expiry.GetInt32() - 120) : 300));
        return token;
    }

    public async Task<string> CreateDraftAsync(string fileName, byte[] pdf, SignatureInput input, CancellationToken ct)
    {
        var token = await TokenAsync(ct);
        using var form = new MultipartFormDataContent();
        var content = new ByteArrayContent(pdf);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        form.Add(content, "File", fileName);
        var document = await SigningHttp.JsonAsync(http, HttpMethod.Post, Root + "/transientDocuments", token, form, ct, "Adobe Sign PDF upload");
        var result = await SigningHttp.JsonAsync(http, HttpMethod.Post, Root + "/agreements", token, JsonContent.Create(new
        {
            name = input.Subject,
            message = input.Message,
            fileInfos = new[] { new { transientDocumentId = document.GetProperty("transientDocumentId").GetString() } },
            participantSetsInfo = input.Recipients.Select((recipient, index) => new
            {
                memberInfos = new[] { new { email = recipient.Email, name = recipient.Name } },
                order = index + 1,
                role = "SIGNER"
            }),
            signatureType = "ESIGN",
            state = "AUTHORING",
            externalId = new { id = input.ClientRequestId.ToString() }
        }), ct, "Adobe Sign draft creation");
        return result.GetProperty("id").GetString()!;
    }

    public async Task<string> GetPreparationUrlAsync(string externalId, CancellationToken ct)
    {
        var result = await SigningHttp.JsonAsync(http, HttpMethod.Post, $"{Root}/agreements/{Uri.EscapeDataString(externalId)}/views", await TokenAsync(ct),
            JsonContent.Create(new { name = "AUTHORING", commonViewConfiguration = new { autoLoginUser = true, noChrome = true } }), ct, "Adobe Sign preparation screen");
        return SigningHttp.PreparationUrl(result.GetProperty("agreementViewList")[0].GetProperty("url").GetString()!);
    }

    public async Task<string> GetStatusAsync(string externalId, CancellationToken ct)
    {
        var result = await SigningHttp.JsonAsync(http, HttpMethod.Get, $"{Root}/agreements/{Uri.EscapeDataString(externalId)}", await TokenAsync(ct), null, ct, "Adobe Sign status refresh");
        return result.GetProperty("status").GetString()!;
    }

    public async Task<byte[]> DownloadAsync(string externalId, bool audit, CancellationToken ct)
    {
        using var response = await SigningHttp.SendAsync(http, HttpMethod.Get,
            $"{Root}/agreements/{Uri.EscapeDataString(externalId)}/{(audit ? "auditTrail" : "combinedDocument")}", await TokenAsync(ct), null, ct, "Adobe Sign document download");
        return await response.Content.ReadAsByteArrayAsync(ct);
    }
}
