namespace ChatApp.Domain.Models;

public sealed class FormResponseAttachment
{
    public Guid Id { get; set; }

    public Guid ResponseId { get; set; }

    public Guid? CreatedById { get; set; }

    public Guid? FormOwnerId { get; set; }

    public string QuestionId { get; set; } = "";

    public string FileName { get; set; } = "";

    public string StorageKey { get; set; } = "";

    public long SizeBytes { get; set; }
}
