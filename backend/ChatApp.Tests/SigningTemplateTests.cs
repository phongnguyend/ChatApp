using ChatApp.Infrastructure.DocumentSigning;
using Xunit;

namespace ChatApp.Tests;

public sealed class SigningTemplateTests
{
    [Fact]
    public void TemplatesStripValuesAndPreserveLayout()
    {
        SigningField[] fields =
        [
            new("signature", "signature", 1, 0.1, 0.2, 0.3, 0.1, "private signature image"),
            new("text", "text", 2, 0.1, 0.2, 0.3, 0.1, "private text")
        ];
        var result = SigningTemplateService.Normalize(new("  Contract  ", fields, 2));
        Assert.Equal("Contract", result.Name);
        Assert.All(result.Fields, field => Assert.Null(field.Value));
        Assert.Equal(fields.Select(field => field with { Value = null }), result.Fields);
        Assert.NotNull(fields[0].Value);
    }

    [Theory]
    [InlineData("", 1)]
    [InlineData("Bad\nName", 1)]
    [InlineData("Layout", 0)]
    [InlineData("Layout", 10001)]
    [InlineData("Layout", 1)]
    public void InvalidNamesAndPageCountsAreRejected(string name, int pages)
    {
        SigningField field = new("field", "signature", 2, 0.1, 0.2, 0.3, 0.1, null);
        Assert.Throws<ArgumentException>(() => SigningTemplateService.Normalize(new(name, [field], pages)));
    }

    [Fact]
    public void EmptyNullAndOutOfBoundsLayoutsAreRejected()
    {
        Assert.Throws<ArgumentException>(() => SigningTemplateService.Normalize(null));
        Assert.Throws<ArgumentException>(() => SigningTemplateService.Normalize(new("Layout", [], 1)));
        Assert.Throws<ArgumentException>(() => SigningTemplateService.Normalize(new("Layout", [null!], 1)));
        SigningField field = new("field", "signature", 1, 0.9, 0.2, 0.3, 0.1, null);
        Assert.Throws<ArgumentException>(() => SigningTemplateService.Normalize(new("Layout", [field], 1)));
    }
}
