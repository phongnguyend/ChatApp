using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Caching.Memory;
using ChatApp.Application;
using ChatApp.Infrastructure;
using ChatApp.Infrastructure.DocumentSigning;
using Xunit;

namespace ChatApp.Tests;

public sealed class SigningProviderTests
{
    private static SignatureInput Input => new("DocuSign", "Contract", "Please review", [new("Signer", "signer@example.com"), new("Second", "second@example.com")], Guid.NewGuid());

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task DocuSignCreatesDraftWithSequentialRecipientsAndObtainsSenderView(bool escaped, bool pkcs8)
    {
        using var rsa = RSA.Create(2048);
        var pem = pkcs8 ? rsa.ExportPkcs8PrivateKeyPem() : rsa.ExportRSAPrivateKeyPem();
        if (escaped)
        {
            pem = pem.ReplaceLineEndings("\n").Replace("\n", "\\n");
        }
        var settings = Options.Create(new DocumentSigningOptions
        {
            ReturnUrl = "https://app.example.com/attachments",
            DocuSign = new() { Enabled = true, PrivateKeyPem = pem, AccountId = "company", ClientId = "client", SenderUserId = "sender" }
        });
        var requests = new List<string>();
        using var handler = new Handler(async request =>
        {
            var path = request.RequestUri!.AbsolutePath;
            requests.Add(path);
            if (path == "/oauth/token")
            {
                var form = await request.Content!.ReadAsStringAsync();
                Assert.Contains("assertion=", form);
                return Json(new { access_token = "test-token" });
            }
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.Equal("test-token", request.Headers.Authorization?.Parameter);
            if (path.EndsWith("/views/sender"))
            {
                using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
                Assert.Equal(settings.Value.ReturnUrl, body.RootElement.GetProperty("returnUrl").GetString());
                return Json(new { url = "https://demo.docusign.net/prepare" });
            }
            using var json = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
            Assert.Equal("created", json.RootElement.GetProperty("status").GetString());
            Assert.Equal("2", json.RootElement.GetProperty("recipients").GetProperty("signers")[1].GetProperty("routingOrder").GetString());
            Assert.Equal(Convert.ToBase64String("%PDF-test"u8), json.RootElement.GetProperty("documents")[0].GetProperty("documentBase64").GetString());
            return Json(new { envelopeId = "draft-id" });
        });
        using var http = new HttpClient(handler);
        using var tokenCache = new MemoryCache(new MemoryCacheOptions());
        var provider = new DocuSignService(http, settings, tokenCache);
        Assert.Equal("draft-id", await provider.CreateDraftAsync("contract.pdf", "%PDF-test"u8.ToArray(), Input, default));
        Assert.Equal("https://demo.docusign.net/prepare", await provider.GetPreparationUrlAsync("draft-id", default));
        Assert.Contains("/restapi/v2.1/accounts/company/envelopes", requests);
    }

    [Fact]
    public async Task AdobeUploadsPdfCreatesAuthoringAgreementAndUsesSharedSenderView()
    {
        using var handler = new Handler(async request =>
        {
            var path = request.RequestUri!.AbsolutePath;
            if (path.EndsWith("/refresh"))
            {
                Assert.Contains("refresh_token=shared-refresh", await request.Content!.ReadAsStringAsync());
                return Json(new { access_token = "test-token" });
            }
            Assert.Equal("test-token", request.Headers.Authorization?.Parameter);
            if (path.EndsWith("/transientDocuments"))
            {
                Assert.IsType<MultipartFormDataContent>(request.Content);
                Assert.Contains("%PDF-test", await request.Content.ReadAsStringAsync());
                return Json(new { transientDocumentId = "uploaded" });
            }
            using var json = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
            if (path.EndsWith("/views"))
            {
                Assert.Equal("AUTHORING", json.RootElement.GetProperty("name").GetString());
                Assert.True(json.RootElement.GetProperty("commonViewConfiguration").GetProperty("autoLoginUser").GetBoolean());
                return Json(new { agreementViewList = new[] { new { url = "https://secure.na1.adobesign.com/prepare" } } });
            }
            Assert.Equal("AUTHORING", json.RootElement.GetProperty("state").GetString());
            Assert.Equal("uploaded", json.RootElement.GetProperty("fileInfos")[0].GetProperty("transientDocumentId").GetString());
            Assert.Equal(2, json.RootElement.GetProperty("participantSetsInfo")[1].GetProperty("order").GetInt32());
            return Json(new { id = "agreement" });
        });
        using var http = new HttpClient(handler);
        using var tokenCache = new MemoryCache(new MemoryCacheOptions());
        var provider = new AdobeSignService(http, Options.Create(new DocumentSigningOptions
        {
            AdobeSign = new() { Enabled = true, ApiAccessPoint = "https://api.na1.adobesign.com", RefreshToken = "shared-refresh" }
        }), tokenCache);
        Assert.Equal("agreement", await provider.CreateDraftAsync("contract.pdf", "%PDF-test"u8.ToArray(), Input, default));
        Assert.Equal("https://secure.na1.adobesign.com/prepare", await provider.GetPreparationUrlAsync("agreement", default));
    }

    [Fact]
    public async Task InvalidDocuSignKeyIdentifiesConfigurationWithoutExposingKeyOrCallingProvider()
    {
        using var handler = new Handler(_ => throw new InvalidOperationException("Provider must not be called."));
        using var http = new HttpClient(handler);
        using var tokenCache = new MemoryCache(new MemoryCacheOptions());
        var provider = new DocuSignService(http, Options.Create(new DocumentSigningOptions
        {
            DocuSign = new() { PrivateKeyPem = "private-invalid-key-value" }
        }), tokenCache);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => provider.GetStatusAsync("id", default));
        Assert.Contains("DOCUMENTSIGNING__DOCUSIGN__PRIVATEKEYPEM", error.Message);
        Assert.DoesNotContain("private-invalid-key-value", error.ToString());
    }

    [Theory]
    [InlineData("https://attacker.example/prepare")]
    [InlineData("http://demo.docusign.net/prepare")]
    [InlineData("https://docusign.net.attacker.example/prepare")]
    public async Task UntrustedPreparationUrlsAreRejected(string url)
    {
        using var handler = new Handler(request => Task.FromResult(request.RequestUri!.AbsolutePath.EndsWith("/refresh")
            ? Json(new { access_token = "test" }) : Json(new { agreementViewList = new[] { new { url } } })));
        using var http = new HttpClient(handler);
        using var tokenCache = new MemoryCache(new MemoryCacheOptions());
        var provider = new AdobeSignService(http, Options.Create(new DocumentSigningOptions { AdobeSign = new() { ApiAccessPoint = "https://api.na1.adobesign.com" } }), tokenCache);
        await Assert.ThrowsAsync<InvalidOperationException>(() => provider.GetPreparationUrlAsync("id", default));
    }

    [Fact]
    public async Task ProviderErrorBodiesDoNotLeakSecrets()
    {
        using var handler = new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized) { Content = new StringContent("secret-token") }));
        using var http = new HttpClient(handler);
        using var tokenCache = new MemoryCache(new MemoryCacheOptions());
        var provider = new AdobeSignService(http, Options.Create(new DocumentSigningOptions { AdobeSign = new() { ApiAccessPoint = "https://api.na1.adobesign.com" } }), tokenCache);
        var error = await Assert.ThrowsAsync<HttpRequestException>(() => provider.GetStatusAsync("id", default));
        Assert.DoesNotContain("secret-token", error.Message);
    }

    [Fact]
    public void ValidationRejectsInvalidAndDuplicateRecipients()
    {
        SignatureRequestService.Validate(Input);
        Assert.Throws<ArgumentException>(() => SignatureRequestService.Validate(Input with { Recipients = [] }));
        Assert.Throws<ArgumentException>(() => SignatureRequestService.Validate(Input with { Recipients = [new("A", "invalid")] }));
        Assert.Throws<ArgumentException>(() => SignatureRequestService.Validate(Input with { Recipients = [new("A", "a@example.com"), new("B", "A@example.com")] }));
        Assert.Throws<ArgumentException>(() => SignatureRequestService.Validate(Input with { ClientRequestId = Guid.Empty }));
    }

    [Theory]
    [InlineData("/oauth/v2/refresh", "token refresh")]
    [InlineData("/api/rest/v6/transientDocuments", "PDF upload")]
    [InlineData("/api/rest/v6/agreements", "draft creation")]
    [InlineData("/api/rest/v6/agreements/agreement/views", "preparation screen")]
    public async Task AdobeForbiddenErrorsIdentifyTheFailedStepWithoutExposingProviderMessages(string failedPath, string step)
    {
        using var handler = new Handler(request =>
        {
            var path = request.RequestUri!.AbsolutePath;
            if (path == failedPath)
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Forbidden)
                {
                    Content = JsonContent.Create(new { code = "PERMISSION_DENIED", message = "private-account-secret" })
                });
            }
            return Task.FromResult(Json(new { access_token = "test-token", transientDocumentId = "uploaded", id = "agreement" }));
        });
        using var http = new HttpClient(handler);
        using var tokenCache = new MemoryCache(new MemoryCacheOptions());
        var provider = new AdobeSignService(http, Options.Create(new DocumentSigningOptions
        {
            AdobeSign = new() { ApiAccessPoint = "https://api.na1.adobesign.com" }
        }), tokenCache);
        var error = await Assert.ThrowsAsync<HttpRequestException>(async () =>
        {
            var id = await provider.CreateDraftAsync("contract.pdf", "%PDF-test"u8.ToArray(), Input, default);
            await provider.GetPreparationUrlAsync(id, default);
        });
        Assert.Equal(HttpStatusCode.Forbidden, error.StatusCode);
        Assert.Contains($"Adobe Sign {step} returned HTTP 403 (PERMISSION_DENIED)", error.Message);
        Assert.DoesNotContain("private-account-secret", error.ToString());
    }

    private static HttpResponseMessage Json(object value) => new(HttpStatusCode.OK) { Content = JsonContent.Create(value) };

    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => respond(request);
    }
}
