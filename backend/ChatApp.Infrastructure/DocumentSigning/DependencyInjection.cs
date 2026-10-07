using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ChatApp.Application;

namespace ChatApp.Infrastructure.DocumentSigning;

public static class DependencyInjection
{
    public static IServiceCollection AddDocumentSigningServices(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddMemoryCache();
        services.AddOptions<DocumentSigningOptions>().Bind(configuration.GetSection(DocumentSigningOptions.SectionName))
            .Validate(o => !o.DocuSign.Enabled || Guid.TryParse(o.DocuSign.AccountId, out _),
                "DocumentSigning:DocuSign:AccountId must be the API Account ID GUID from DocuSign Apps and Keys.")
            .Validate(o => !o.DocuSign.Enabled || Guid.TryParse(o.DocuSign.ClientId, out _),
                "DocumentSigning:DocuSign:ClientId must be the Integration Key GUID from DocuSign Apps and Keys.")
            .Validate(o => !o.DocuSign.Enabled || Guid.TryParse(o.DocuSign.SenderUserId, out _),
                "DocumentSigning:DocuSign:SenderUserId must be the User ID GUID of the shared sender who granted JWT consent (not the account ID or email).")
            .Validate(o => !o.DocuSign.Enabled || !string.IsNullOrWhiteSpace(o.DocuSign.PrivateKeyPem),
                "DocumentSigning:DocuSign:PrivateKeyPem is required. Configure the RSA private key, including its PEM header and footer.")
            .Validate(o => !o.DocuSign.Enabled || ProviderUrl(o.DocuSign.ApiBaseUrl, "docusign.net"),
                "DocumentSigning:DocuSign:ApiBaseUrl must be an HTTPS DocuSign REST API URL, for example https://demo.docusign.net/restapi/v2.1/.")
            .Validate(o => !o.DocuSign.Enabled || ReturnUrl(o.ReturnUrl),
                "DocumentSigning:ReturnUrl must be an absolute HTTPS frontend URL, or HTTP localhost for development.")
            .Validate(o => !o.AdobeSign.Enabled || (ProviderUrl(o.AdobeSign.ApiAccessPoint, "adobesign.com")
                && !string.IsNullOrWhiteSpace(o.AdobeSign.ClientId) && !string.IsNullOrWhiteSpace(o.AdobeSign.ClientSecret)
                && !string.IsNullOrWhiteSpace(o.AdobeSign.RefreshToken)), "Configure the AdobeSign shared sender OAuth credentials and API access point.")
            .ValidateOnStart();
        services.AddHttpClient<DocuSignService>(client => client.Timeout = TimeSpan.FromMinutes(2))
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
        services.AddHttpClient<AdobeSignService>(client => client.Timeout = TimeSpan.FromMinutes(2))
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
        services.AddTransient<ISignatureProvider>(sp => sp.GetRequiredService<DocuSignService>());
        services.AddTransient<ISignatureProvider>(sp => sp.GetRequiredService<AdobeSignService>());
        services.AddScoped<SignatureRequestService>();
        services.AddScoped<SigningTemplateService>();
        services.AddScoped<SigningStorage>();
        return services;
    }

    private static bool ProviderUrl(string value, string domain) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == "https" && uri.Host.EndsWith("." + domain, StringComparison.OrdinalIgnoreCase)
        && string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Query) && string.IsNullOrEmpty(uri.Fragment);

    private static bool ReturnUrl(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && (uri.Scheme == "https" || (uri.Scheme == "http" && uri.IsLoopback));
}
