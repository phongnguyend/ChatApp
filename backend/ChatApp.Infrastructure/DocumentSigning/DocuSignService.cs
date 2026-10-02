using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Caching.Memory;
using ChatApp.Application;

namespace ChatApp.Infrastructure.DocumentSigning;

public sealed class DocuSignService(HttpClient http, IOptions<DocumentSigningOptions> options, IMemoryCache tokenCache) : ISignatureProvider
{
    private readonly DocuSignOptions settings = options.Value.DocuSign;

    public string Name => "DocuSign";

    public bool Enabled => settings.Enabled;

    private string Root => settings.ApiBaseUrl.TrimEnd('/') + "/accounts/" + Uri.EscapeDataString(settings.AccountId) + "/envelopes";

    private async Task<string> TokenAsync(CancellationToken ct)
    {
        var host = settings.Demo ? "account-d.docusign.com" : "account.docusign.com";
        var cacheKey = ("Signing.DocuSign", host, settings.ClientId, settings.SenderUserId);
        if (tokenCache.TryGetValue<string>(cacheKey, out var cached) && cached is not null)
        {
            return cached;
        }
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        static string Encode(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var unsigned = Encode(JsonSerializer.SerializeToUtf8Bytes(new { alg = "RS256", typ = "JWT" })) + "." +
            Encode(JsonSerializer.SerializeToUtf8Bytes(new { iss = settings.ClientId, sub = settings.SenderUserId, aud = host, iat = now, exp = now + 3600, scope = "signature impersonation" }));
        using var rsa = RSA.Create();
        var pem = settings.PrivateKeyPem.Replace("\\r\\n", "\n").Replace("\\n", "\n").Trim();
        try
        {
            rsa.ImportFromPem(pem);
        }
        catch (Exception error) when (error is ArgumentException or CryptographicException)
        {
            throw new InvalidOperationException("DocumentSigning:DocuSign:PrivateKeyPem must contain the complete unencrypted RSA private key PEM, including BEGIN and END PRIVATE KEY (or RSA PRIVATE KEY) lines. Set the GitHub environment secret DOCUMENTSIGNING__DOCUSIGN__PRIVATEKEYPEM to the key contents, not a file path, and release API again.");
        }
        var assertion = unsigned + "." + Encode(rsa.SignData(Encoding.UTF8.GetBytes(unsigned), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
        var result = await SigningHttp.JsonAsync(http, HttpMethod.Post, $"https://{host}/oauth/token", null,
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "urn:ietf:params:oauth:grant-type:jwt-bearer",
                ["assertion"] = assertion
            }), ct);
        var token = result.GetProperty("access_token").GetString()!;
        tokenCache.Set(cacheKey, token, TimeSpan.FromSeconds(result.TryGetProperty("expires_in", out var expiry) ? Math.Max(1, expiry.GetInt32() - 120) : 300));
        return token;
    }

    public async Task<string> CreateDraftAsync(string fileName, byte[] pdf, SignatureInput input, CancellationToken ct)
    {
        var result = await SigningHttp.JsonAsync(http, HttpMethod.Post, Root, await TokenAsync(ct), JsonContent.Create(new
        {
            emailSubject = input.Subject,
            emailBlurb = input.Message,
            status = "created",
            transactionId = input.ClientRequestId.ToString(),
            documents = new[] { new { documentBase64 = Convert.ToBase64String(pdf), name = fileName, fileExtension = "pdf", documentId = "1" } },
            recipients = new
            {
                signers = input.Recipients.Select((recipient, index) => new
                {
                    name = recipient.Name,
                    email = recipient.Email,
                    recipientId = (index + 1).ToString(),
                    routingOrder = (index + 1).ToString()
                })
            }
        }), ct);
        return result.GetProperty("envelopeId").GetString()!;
    }

    public async Task<string> GetPreparationUrlAsync(string externalId, CancellationToken ct)
    {
        var result = await SigningHttp.JsonAsync(http, HttpMethod.Post, $"{Root}/{Uri.EscapeDataString(externalId)}/views/sender", await TokenAsync(ct),
            JsonContent.Create(new { returnUrl = options.Value.ReturnUrl }), ct);
        return SigningHttp.PreparationUrl(result.GetProperty("url").GetString()!);
    }

    public async Task<string> GetStatusAsync(string externalId, CancellationToken ct)
    {
        var result = await SigningHttp.JsonAsync(http, HttpMethod.Get, $"{Root}/{Uri.EscapeDataString(externalId)}", await TokenAsync(ct), null, ct);
        return result.GetProperty("status").GetString()!;
    }

    public async Task<byte[]> DownloadAsync(string externalId, bool audit, CancellationToken ct)
    {
        using var response = await SigningHttp.SendAsync(http, HttpMethod.Get,
            $"{Root}/{Uri.EscapeDataString(externalId)}/documents/{(audit ? "certificate" : "combined")}", await TokenAsync(ct), null, ct);
        return await response.Content.ReadAsByteArrayAsync(ct);
    }
}
