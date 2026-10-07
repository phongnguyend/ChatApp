namespace ChatApp.Domain.Models;

public sealed class UserForm
{
    public Guid Id { get; set; }

    public Guid OwnerId { get; set; }

    public string Title { get; set; } = "Untitled form";

    public string DraftJson { get; set; } = "{}";

    public string ShareToken { get; set; } = "";

    public bool IsPublished { get; set; }

    public int PublishedVersion { get; set; }

    public int Revision { get; set; } = 1;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class FormPublication
{
    public Guid Id { get; set; }

    public Guid FormId { get; set; }

    public int Version { get; set; }

    public string DefinitionJson { get; set; } = "{}";

    public DateTimeOffset PublishedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class FormResponse
{
    public Guid Id { get; set; }

    public Guid FormId { get; set; }

    public Guid PublicationId { get; set; }

    public Guid SubmissionKey { get; set; }

    public string AnswersJson { get; set; } = "{}";

    public DateTimeOffset SubmittedAt { get; set; } = DateTimeOffset.UtcNow;
}
