namespace ChatApp.Domain.Models;

public sealed class SigningTemplateEntity
{
    public Guid Id { get; set; }

    public Guid CreatedById { get; set; }

    public string Name { get; set; } = "";

    public string FieldsJson { get; set; } = "[]";

    public int FieldCount { get; set; }

    public int PageCount { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }
}
