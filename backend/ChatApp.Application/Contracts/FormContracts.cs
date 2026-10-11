namespace ChatApp.Application.Contracts;

public sealed record FormDefinition(string Title, string Description, string ConfirmationMessage, FormNode[] Nodes);

public sealed record FormNode
{
    public string Id { get; init; } = "";

    public string Kind { get; init; } = "text";

    public string LinkUrl { get; init; } = "";

    public bool LinkOpenNewTab { get; init; } = true;

    public string? ImageDataUrl { get; init; }

    public string ImageDisplay { get; init; } = "banner";

    public int? ImageHeight { get; init; }

    public int? ImageWidth { get; init; }

    public string Label { get; init; } = "";

    public string Description { get; init; } = "";

    public string ParagraphAlignment { get; init; } = "left";

    public string Code { get; init; } = "";

    public string Markdown { get; init; } = "";

    public string CodeLanguage { get; init; } = "text";

    public bool CodeWrap { get; init; }

    public bool Required { get; init; }

    public bool AllowMultipleFiles { get; init; }

    public int MaxFiles { get; init; } = 10;

    public int MaxFileSizeMb { get; init; } = 5;

    public string[] AllowedExtensions { get; init; } = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf", ".txt", ".csv", ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif"];

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

public sealed record SubmitFormRequest(int Version, Guid SubmissionKey, Dictionary<string, string[]> Answers, Dictionary<string, Guid[]>? Attachments = null);
