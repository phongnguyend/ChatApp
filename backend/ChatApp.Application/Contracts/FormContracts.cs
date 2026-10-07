namespace ChatApp.Application.Contracts;

public sealed record FormDefinition(string Title, string Description, string ConfirmationMessage, FormNode[] Nodes);

public sealed record FormNode
{
    public string Id { get; init; } = "";

    public string Kind { get; init; } = "text";

    public string Label { get; init; } = "";

    public string Description { get; init; } = "";

    public bool Required { get; init; }

    public string[] Options { get; init; } = [];

    public decimal? Min { get; init; }

    public decimal? Max { get; init; }

    public FormNode[] Children { get; init; } = [];

    public string ConditionMode { get; init; } = "all";

    public FormCondition[] Conditions { get; init; } = [];
}

public sealed record FormCondition(string QuestionId, string Operator, string Value);

public sealed record SaveFormRequest(int Revision, FormDefinition Definition);

public sealed record FormRevisionRequest(int Revision);

public sealed record SubmitFormRequest(int Version, Guid SubmissionKey, Dictionary<string, string[]> Answers);
