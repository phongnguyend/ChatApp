namespace ChatApp.Domain.Models;

public sealed class SignatureRequestEntity
{
    public required string OriginalStorageKey { get; set; }
    public required string OriginalFileName { get; set; }
    public long OriginalSizeBytes { get; set; }
    public long SignedSizeBytes { get; set; }

    public Guid Id { get; set; }

    public Guid DocumentId { get; set; }

    public Guid CreatedById { get; set; }

    public Guid ClientRequestId { get; set; }

    public string Provider { get; set; } = "";

    public string? ExternalId { get; set; }

    public string Subject { get; set; } = "";

    public string? Message { get; set; }

    public string RecipientsJson { get; set; } = "[]";

    public string Status { get; set; } = "Creating";

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }

    public string? FieldsJson { get; set; }

    public string? SignedDocumentBlobName { get; set; }

    public string? OriginalSha256 { get; set; }

    public string? SignedSha256 { get; set; }

    public DateTimeOffset? CompletedAtUtc { get; set; }
}
