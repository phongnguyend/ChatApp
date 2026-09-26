namespace ChatApp.Domain.Models;

public sealed class ScheduledMeetingParticipant
{
    public Guid MeetingId { get; set; }
    public ScheduledMeeting Meeting { get; set; } = null!;
    public Guid UserId { get; set; }
    public ChatUser User { get; set; } = null!;
    public string ResponseStatus { get; set; } = "pending";
    public DateTimeOffset? RespondedAt { get; set; }
}
