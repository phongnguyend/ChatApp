using ChatApp.Application.Contracts;
using ChatApp.Application.Forms;
using Xunit;

namespace ChatApp.Tests;

public sealed class FormRulesTests
{
    private static FormNode Question(string id, string kind = "text", bool required = false) => new() { Id = id, Kind = kind, Label = id, Required = required };

    private static FormDefinition Definition(params FormNode[] nodes) => new("Survey", "", "Thanks", nodes);

    [Fact]
    public void RejectsForwardReferencesCyclesAndDuplicateIds()
    {
        var first = Question("first") with { Conditions = [new("second", "equals", "yes")] };
        var second = Question("second") with { Conditions = [new("first", "equals", "yes")] };
        var errors = FormRules.ValidateDefinition(Definition(first, second, Question("first")));
        Assert.Contains("first", errors.Keys);
    }

    [Fact]
    public void HiddenRequiredDescendantsAndUnknownAnswersAreNotStored()
    {
        var nested = new FormNode { Id = "section", Kind = "section", Conditions = [new("choice", "equals", "Yes")], Children = [Question("secret", required: true)] };
        var form = Definition(Question("choice", "yesno", true), nested);
        var result = FormRules.ValidateAnswers(form, new() { ["choice"] = ["No"], ["secret"] = ["forged"], ["unknown"] = ["forged"] });
        Assert.Empty(result.Errors);
        Assert.Single(result.Answers);
        Assert.Equal("No", result.Answers["choice"][0]);
        var visible = FormRules.ValidateAnswers(form, new() { ["choice"] = ["Yes"] });
        Assert.Contains("secret", visible.Errors.Keys);
    }

    [Fact]
    public void NestedColumnsAndAnyConditionsEvaluateInDisplayOrder()
    {
        var dependent = Question("detail", required: true) with { ConditionMode = "any", Conditions = [new("choice", "equals", "Yes"), new("number", "answered", "")] };
        var layout = new FormNode { Id = "columns", Kind = "columns", Children = [
            new() { Id = "left", Kind = "section", Children = [Question("number", "number")] },
            new() { Id = "right", Kind = "section", Children = [dependent] }
        ] };
        var definition = Definition(Question("choice", "yesno"), layout);
        Assert.Empty(FormRules.ValidateDefinition(definition, true));
        Assert.Contains("detail", FormRules.ValidateAnswers(definition, new() { ["number"] = ["2"] }).Errors.Keys);
        Assert.Empty(FormRules.ValidateAnswers(definition, new()).Errors);
    }

    [Theory]
    [InlineData("email", "invalid")]
    [InlineData("date", "2026-02-30")]
    [InlineData("time", "24:00")]
    [InlineData("time", "12:60")]
    [InlineData("time", "9:30")]
    [InlineData("time", "12:30:15")]
    [InlineData("datetime", "2026-02-30T09:30")]
    [InlineData("datetime", "2026-10-07T24:00")]
    [InlineData("datetime", "2026-10-07")]
    [InlineData("datetime", "2026-10-07T09:30Z")]
    [InlineData("datetime", "2026-10-07T09:30+07:00")]
    [InlineData("number", "NaN")]
    [InlineData("rating", "6")]
    [InlineData("yesno", "Maybe")]
    [InlineData("radio", "forged")]
    [InlineData("checkbox", "forged")]
    [InlineData("select", "forged")]
    public void RejectsInvalidAnswers(string kind, string value)
    {
        var question = Question("answer", kind) with { Options = ["A", "B"] };
        Assert.Contains("answer", FormRules.ValidateAnswers(Definition(question), new() { ["answer"] = [value] }).Errors.Keys);
    }

    [Theory]
    [InlineData("time", "00:00")]
    [InlineData("time", "23:59")]
    [InlineData("datetime", "2028-02-29T09:30")]
    [InlineData("datetime", "2026-10-07T00:00")]
    public void TemporalQuestionsPreserveLocalValuesAndRequireAnswers(string kind, string value)
    {
        var definition = Definition(Question("when", kind, required: true));
        Assert.Empty(FormRules.ValidateDefinition(definition, true));
        var result = FormRules.ValidateAnswers(definition, new() { ["when"] = [value] });
        Assert.Empty(result.Errors);
        Assert.Equal(value, Assert.Single(result.Answers["when"]));
        Assert.Contains("when", FormRules.ValidateAnswers(definition, new()).Errors.Keys);
    }

    [Fact]
    public void EnforcesBoundsAndCardinality()
    {
        var question = Question("number", "number") with { Min = 2, Max = 4 };
        Assert.Empty(FormRules.ValidateAnswers(Definition(question), new() { ["number"] = ["2.5"] }).Errors);
        Assert.NotEmpty(FormRules.ValidateAnswers(Definition(question), new() { ["number"] = ["5"] }).Errors);
        Assert.NotEmpty(FormRules.ValidateAnswers(Definition(question), new() { ["number"] = ["2", "3"] }).Errors);
    }

    [Fact]
    public void RejectsMalformedAndOversizedDefinitions()
    {
        Assert.NotEmpty(FormRules.ValidateDefinition(Definition(new FormNode { Id = "x", Kind = "columns", Children = [] })));
        Assert.NotEmpty(FormRules.ValidateDefinition(Definition(Enumerable.Range(0, 201).Select(x => Question(x.ToString())).ToArray())));
        var nested = Question("deep");
        for (var i = 0; i < 9; i++)
        {
            nested = new FormNode { Id = $"section-{i}", Kind = "section", Children = [nested] };
        }
        Assert.NotEmpty(FormRules.ValidateDefinition(Definition(nested)));
        Assert.NotEmpty(FormRules.ValidateDefinition(Definition(Question("choice", "select") with { Options = ["same", "same"] })));
        Assert.NotEmpty(FormRules.ValidateDefinition(Definition(Question("rating", "rating") with { Max = 100 })));
        Assert.NotEmpty(FormRules.ValidateDefinition(Definition(), true));
        Assert.Empty(FormRules.ValidateDefinition(Definition()));
    }

    [Fact]
    public void RejectsNullPayloadPartsWithoutThrowing()
    {
        Assert.NotEmpty(FormRules.ValidateDefinition(new(null!, null!, null!, null!)));
        Assert.NotEmpty(FormRules.ValidateDefinition(Definition(Question("bad") with { Options = null!, Conditions = null!, Children = null! })));
        Assert.NotEmpty(FormRules.ValidateAnswers(Definition(Question("bad")), null).Errors);
        Assert.NotEmpty(FormRules.ValidateAnswers(Definition(Question("bad")), new() { ["bad"] = [null!] }).Errors);
    }
}
