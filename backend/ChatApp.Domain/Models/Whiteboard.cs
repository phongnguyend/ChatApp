namespace ChatApp.Domain.Models;

public sealed class Whiteboard
{
    public Guid Id { get; set; }

    public Guid CreatedById { get; set; }

    public string Title { get; set; } = "Untitled whiteboard";

    public string DocumentJson { get; set; } = "[]";

    public int Revision { get; set; }

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class WhiteboardMember
{
    public Guid Id { get; set; }

    public Guid WhiteboardId { get; set; }

    public Guid UserId { get; set; }

    public bool CanEdit { get; set; }
}

public sealed class WhiteboardVersion
{
    public Guid Id { get; set; }

    public Guid WhiteboardId { get; set; }

    public Guid? OperationId { get; set; }

    public Guid CreatedById { get; set; }

    public int Revision { get; set; }

    public string DocumentJson { get; set; } = "[]";

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class WhiteboardImage
{
    public Guid Id { get; set; }

    public Guid WhiteboardId { get; set; }

    public Guid DocumentId { get; set; }
}
