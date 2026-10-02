using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using ChatApp.Application;
using ChatApp.Infrastructure.DocumentSigning;
using Xunit;

namespace ChatApp.Tests;

public sealed class SigningConfigurationTests
{
    [Theory]
    [InlineData("DocuSign:AccountId")]
    [InlineData("DocuSign:ClientId")]
    [InlineData("DocuSign:SenderUserId")]
    [InlineData("DocuSign:PrivateKeyPem")]
    [InlineData("DocuSign:ApiBaseUrl")]
    [InlineData("ReturnUrl")]
    public void MissingSettingIsIdentifiedWithoutExposingValues(string missing)
    {
        var values = new Dictionary<string, string?>
        {
            ["DocumentSigning:DocuSign:Enabled"] = "true",
            ["DocumentSigning:DocuSign:AccountId"] = "11111111-1111-1111-1111-111111111111",
            ["DocumentSigning:DocuSign:ClientId"] = "22222222-2222-2222-2222-222222222222",
            ["DocumentSigning:DocuSign:SenderUserId"] = "33333333-3333-3333-3333-333333333333",
            ["DocumentSigning:DocuSign:PrivateKeyPem"] = "private-key-must-not-be-logged",
            ["DocumentSigning:DocuSign:ApiBaseUrl"] = "https://demo.docusign.net/restapi/v2.1/",
            ["DocumentSigning:ReturnUrl"] = "http://localhost:5173"
        };
        values["DocumentSigning:" + missing] = "";
        var services = new ServiceCollection();
        services.AddDocumentSigningServices(new ConfigurationBuilder().AddInMemoryCollection(values).Build());
        using var provider = services.BuildServiceProvider();
        var error = Assert.Throws<OptionsValidationException>(() => provider.GetRequiredService<IOptions<DocumentSigningOptions>>().Value);
        Assert.Single(error.Failures);
        Assert.Contains("DocumentSigning:" + missing, error.Message);
        Assert.DoesNotContain("private-key-must-not-be-logged", error.Message);
    }

    [Fact]
    public void DisabledProvidersDoNotRequireCredentials()
    {
        var services = new ServiceCollection();
        services.AddDocumentSigningServices(new ConfigurationBuilder().Build());
        using var provider = services.BuildServiceProvider();
        Assert.False(provider.GetRequiredService<IOptions<DocumentSigningOptions>>().Value.DocuSign.Enabled);
    }
}
