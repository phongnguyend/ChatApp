namespace ChatApp.Application.Models;

public sealed class ScheduledMeeting
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrganizerUserId { get; set; }
    public ChatUser OrganizerUser { get; set; } = null!;
    public required string Title { get; set; }
    public string? Description { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public bool IsAllDay { get; set; }
    public TimeOnly? StartTime { get; set; }
    public TimeOnly? EndTime { get; set; }
    public string Status { get; set; } = "scheduled";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CancelledAt { get; set; }
    public Guid? ConversationId { get; set; }
    public Conversation? Conversation { get; set; }
    public ICollection<ScheduledMeetingParticipant> Participants { get; set; } = [];
}
