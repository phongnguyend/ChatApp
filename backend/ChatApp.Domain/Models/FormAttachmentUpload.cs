namespace ChatApp.Domain.Models;

public sealed class FormAttachmentUpload
{
    public Guid Id { get; set; }

    public Guid FormId { get; set; }

    public Guid? CreatedById { get; set; }

    public Guid? FormOwnerId { get; set; }

    public Guid PublicationId { get; set; }

    public Guid SubmissionKey { get; set; }

    public string QuestionId { get; set; } = "";

    public string FileName { get; set; } = "";

    public string StorageKey { get; set; } = "";

    public long SizeBytes { get; set; }

    public bool Ready { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }
}
