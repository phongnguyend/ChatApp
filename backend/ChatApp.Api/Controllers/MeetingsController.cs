using ChatApp.Infrastructure.Caching;
using System.Globalization;
using ChatApp.Api.Hubs;
using ChatApp.Api.Services;
using ChatApp.Application.Contracts;
using ChatApp.Persistence;
using ChatApp.Domain.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/meetings")]
public sealed class MeetingsController(
    ChatAppDbContext db,
    IHubContext<ChatHub> hubContext,
    PresenceTracker presence) : ControllerBase
{
    [HttpGet("manage")]
    public async Task<ActionResult<MeetingManagePageDto>> Manage(
        [FromQuery] string username,
        [FromQuery] string tab = "created",
        [FromQuery] int page = 0,
        [FromQuery] string? from = null,
        [FromQuery] string? to = null,
        [FromQuery] string? name = null,
        [FromQuery] string? organizer = null,
        [FromQuery] string? participant = null,
        CancellationToken cancellationToken = default)
    {
        var user = await FindUser(username, cancellationToken);
        if (user is null) return NotFound();
        if (tab is not ("created" or "invited") || page < 0 || page > 10000)
            return BadRequest(new { message = "Choose a valid meeting tab and page." });
        if ((!string.IsNullOrWhiteSpace(from) && !TryDate(from, out _)) ||
            (!string.IsNullOrWhiteSpace(to) && !TryDate(to, out _)))
            return BadRequest(new { message = "Choose valid filter dates." });
        var start = string.IsNullOrWhiteSpace(from)
            ? (DateOnly?)null : DateOnly.ParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var end = string.IsNullOrWhiteSpace(to)
            ? (DateOnly?)null : DateOnly.ParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (start > end)
            return BadRequest(new { message = "The end date must be on or after the start date." });
        name = name?.Trim();
        organizer = organizer?.Trim();
        participant = participant?.Trim();
        if (name?.Length > 200 || organizer?.Length > 100 || participant?.Length > 100)
            return BadRequest(new { message = "A meeting search term is too long." });

        const int pageSize = 50;
        var query = ReadQuery().Where(x => tab == "created"
            ? x.OrganizerUserId == user.Id
            : x.Participants.Any(membership => membership.UserId == user.Id));
        if (start.HasValue) query = query.Where(x => x.EndDate >= start.Value);
        if (end.HasValue) query = query.Where(x => x.StartDate <= end.Value);
        if (!string.IsNullOrEmpty(name))
            query = query.Where(x => x.Title.Contains(name));
        if (tab == "invited" && !string.IsNullOrEmpty(organizer))
            query = query.Where(x => x.OrganizerUser.DisplayName.Contains(organizer) ||
                x.OrganizerUser.Username.Contains(organizer));
        if (!string.IsNullOrEmpty(participant))
            query = query.Where(x => x.Participants.Any(person =>
                person.User.DisplayName.Contains(participant) ||
                person.User.Username.Contains(participant)));
        var meetings = await query.OrderByDescending(x => x.StartDate)
            .ThenByDescending(x => x.StartTime)
            .ThenByDescending(x => x.Id)
            .Skip(page * pageSize)
            .Take(pageSize + 1)
            .ToListAsync(cancellationToken);
        return Ok(new MeetingManagePageDto(
            meetings.Take(pageSize).Select(x => ToDto(x, user.Id)).ToArray(),
            meetings.Count > pageSize));
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ScheduledMeetingDto>>> List(
        [FromQuery] string username,
        [FromQuery] string from,
        [FromQuery] string to,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        if (user is null) return NotFound();
        if (!TryDate(from, out var start) || !TryDate(to, out var end) ||
            end < start || end.DayNumber - start.DayNumber > 366)
            return BadRequest(new { message = "Choose a valid date range of at most one year." });

        var meetings = await ReadQuery()
            .Where(x => x.StartDate <= end && x.EndDate >= start &&
                (x.OrganizerUserId == user.Id ||
                 x.Participants.Any(participant => participant.UserId == user.Id)))
            .OrderBy(x => x.StartDate)
            .ThenBy(x => x.StartTime)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);

        return Ok(meetings.Select(x => ToDto(x, user.Id)).ToArray());
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ScheduledMeetingDto>> GetById(
        Guid id,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        if (user is null) return NotFound();
        var meeting = await ReadQuery().SingleOrDefaultAsync(x => x.Id == id,
            cancellationToken);
        if (meeting is null || !CanView(meeting, user.Id)) return NotFound();
        return Ok(ToDto(meeting, user.Id));
    }

    [HttpPost("{id:guid}/conversation")]
    public async Task<ActionResult<MeetingConversationDto>> OpenConversation(
        Guid id,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        if (user is null) return NotFound();

        await using var transaction = await db.Database.BeginTransactionAsync(
            cancellationToken);
        await LockConversationCreation(id, cancellationToken);
        var meeting = await WriteQuery().SingleOrDefaultAsync(x => x.Id == id,
            cancellationToken);
        if (meeting is null || !CanView(meeting, user.Id)) return NotFound();

        Conversation conversation;
        if (meeting.ConversationId is null)
        {
            conversation = new Conversation
            {
                Type = "group",
                Title = meeting.Title,
                CreatedByUserId = meeting.OrganizerUserId,
                CreatedByUser = meeting.OrganizerUser,
            };
            db.Conversations.Add(conversation);
            meeting.Conversation = conversation;
        }
        else
        {
            conversation = await db.Conversations
                .Include(x => x.Members)
                .SingleAsync(x => x.Id == meeting.ConversationId,
                    cancellationToken);
            conversation.Title = meeting.Title;
        }

        var changes = SyncConversationMembers(meeting, conversation);
        var requesterMembership = conversation.Members.SingleOrDefault(x =>
            x.UserId == user.Id);
        if (requesterMembership is null)
            return Conflict(new { message = "The meeting conversation could not be opened." });
        requesterMembership.IsArchived = false;
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await PublishConversationChanges(conversation.Id, changes,
            cancellationToken);
        return Ok(new MeetingConversationDto(conversation.Id));
    }

    [HttpPost]
    public async Task<ActionResult<ScheduledMeetingDto>> Create(
        [FromQuery] string username,
        SaveScheduledMeetingRequest request,
        CancellationToken cancellationToken)
    {
        var organizer = await FindUser(username, cancellationToken);
        if (organizer is null) return NotFound();
        var validation = Validate(request);
        if (validation.Error is not null)
            return BadRequest(new { message = validation.Error });
        var (people, peopleError) = await FindPeople(request.People, organizer.Id,
            cancellationToken);
        if (peopleError is not null)
            return BadRequest(new { message = peopleError });

        var values = validation.Values!;
        var meeting = new ScheduledMeeting
        {
            OrganizerUserId = organizer.Id,
            OrganizerUser = organizer,
            Title = values.Title,
            Description = values.Description,
            StartDate = values.StartDate,
            EndDate = values.EndDate,
            IsAllDay = values.AllDay,
            StartTime = values.StartTime,
            EndTime = values.EndTime,
        };
        await using var transaction = await db.Database.BeginTransactionAsync(
            cancellationToken);
        db.ScheduledMeetings.Add(meeting);
        await db.SaveChangesAsync(cancellationToken);
        foreach (var person in people!)
        {
            meeting.Participants.Add(new ScheduledMeetingParticipant
            {
                Meeting = meeting,
                UserId = person.Id,
                User = person,
            });
            db.UserNotifications.Add(new UserNotification
            {
                UserId = person.Id,
                ActorUserId = organizer.Id,
                Type = "meeting_invite",
                TargetId = meeting.Id,
                TargetTitle = meeting.Title,
                Details = ScheduleSummary(meeting),
            });
        }
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return CreatedAtAction(nameof(GetById),
            new { id = meeting.Id, username }, ToDto(meeting, organizer.Id));
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ScheduledMeetingDto>> Update(
        Guid id,
        [FromQuery] string username,
        SaveScheduledMeetingRequest request,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        if (user is null) return NotFound();
        await using var transaction = await db.Database.BeginTransactionAsync(
            cancellationToken);
        await LockConversationCreation(id, cancellationToken);
        var meeting = await WriteQuery().SingleOrDefaultAsync(x => x.Id == id,
            cancellationToken);
        if (meeting is null || !CanView(meeting, user.Id)) return NotFound();
        if (meeting.OrganizerUserId != user.Id)
            return StatusCode(403, new { message = "Only the organizer can edit this meeting." });
        if (meeting.Status == "cancelled")
            return Conflict(new { message = "Cancelled meetings cannot be edited." });
        var validation = Validate(request);
        if (validation.Error is not null)
            return BadRequest(new { message = validation.Error });
        var (people, peopleError) = await FindPeople(request.People, user.Id,
            cancellationToken);
        if (peopleError is not null)
            return BadRequest(new { message = peopleError });

        var values = validation.Values!;
        var scheduleChanged = meeting.StartDate != values.StartDate ||
            meeting.EndDate != values.EndDate ||
            meeting.IsAllDay != values.AllDay ||
            meeting.StartTime != values.StartTime ||
            meeting.EndTime != values.EndTime;
        meeting.Title = values.Title;
        meeting.Description = values.Description;
        meeting.StartDate = values.StartDate;
        meeting.EndDate = values.EndDate;
        meeting.IsAllDay = values.AllDay;
        meeting.StartTime = values.StartTime;
        meeting.EndTime = values.EndTime;
        meeting.UpdatedAt = DateTimeOffset.UtcNow;

        var requestedIds = people!.Select(x => x.Id).ToHashSet();
        foreach (var existing in meeting.Participants.ToArray())
        {
            if (requestedIds.Contains(existing.UserId)) continue;
            meeting.Participants.Remove(existing);
            db.ScheduledMeetingParticipants.Remove(existing);
        }
        var existingIds = meeting.Participants.Select(x => x.UserId).ToHashSet();
        foreach (var person in people!)
        {
            if (existingIds.Contains(person.Id)) continue;
            meeting.Participants.Add(new ScheduledMeetingParticipant
            {
                MeetingId = meeting.Id,
                Meeting = meeting,
                UserId = person.Id,
                User = person,
            });
            db.UserNotifications.Add(new UserNotification
            {
                UserId = person.Id,
                ActorUserId = user.Id,
                Type = "meeting_invite",
                TargetId = meeting.Id,
                TargetTitle = meeting.Title,
                Details = ScheduleSummary(meeting),
            });
        }
        if (scheduleChanged)
        {
            foreach (var participant in meeting.Participants.Where(x =>
                existingIds.Contains(x.UserId)))
            {
                participant.ResponseStatus = "pending";
                participant.RespondedAt = null;
                db.UserNotifications.Add(new UserNotification
                {
                    UserId = participant.UserId,
                    ActorUserId = user.Id,
                    Type = "meeting_rescheduled",
                    TargetId = meeting.Id,
                    TargetTitle = meeting.Title,
                    Details = ScheduleSummary(meeting),
                });
            }
        }

        ConversationChanges? conversationChanges = null;
        if (meeting.ConversationId is Guid conversationId)
        {
            var conversation = await db.Conversations
                .Include(x => x.Members)
                .SingleAsync(x => x.Id == conversationId, cancellationToken);
            conversation.Title = meeting.Title;
            conversation.UpdatedAt = DateTimeOffset.UtcNow;
            conversationChanges = SyncConversationMembers(meeting, conversation);
        }

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        if (conversationChanges is not null && meeting.ConversationId is Guid linkedId)
            await PublishConversationChanges(linkedId, conversationChanges,
                cancellationToken);
        return Ok(ToDto(meeting, user.Id));
    }

    [HttpPost("{id:guid}/cancel")]
    public async Task<ActionResult<ScheduledMeetingDto>> Cancel(
        Guid id,
        [FromQuery] string username,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        if (user is null) return NotFound();
        var meeting = await WriteQuery().SingleOrDefaultAsync(x => x.Id == id,
            cancellationToken);
        if (meeting is null || !CanView(meeting, user.Id)) return NotFound();
        if (meeting.OrganizerUserId != user.Id)
            return StatusCode(403, new { message = "Only the organizer can cancel this meeting." });
        if (meeting.Status != "cancelled")
        {
            meeting.Status = "cancelled";
            meeting.CancelledAt = DateTimeOffset.UtcNow;
            meeting.UpdatedAt = meeting.CancelledAt.Value;
            foreach (var participant in meeting.Participants)
                db.UserNotifications.Add(new UserNotification
                {
                    UserId = participant.UserId,
                    ActorUserId = user.Id,
                    Type = "meeting_cancelled",
                    TargetId = meeting.Id,
                    TargetTitle = meeting.Title,
                    Details = ScheduleSummary(meeting),
                });
            await db.SaveChangesAsync(cancellationToken);
        }
        return Ok(ToDto(meeting, user.Id));
    }

    [HttpPost("{id:guid}/response")]
    public async Task<ActionResult<ScheduledMeetingDto>> Respond(
        Guid id,
        [FromQuery] string username,
        MeetingResponseRequest request,
        CancellationToken cancellationToken)
    {
        var user = await FindUser(username, cancellationToken);
        if (user is null) return NotFound();
        var response = request.Response?.Trim().ToLowerInvariant();
        if (response is not ("accepted" or "tentative" or "declined"))
            return BadRequest(new { message = "Choose accepted, tentative, or declined." });

        var meeting = await WriteQuery().SingleOrDefaultAsync(x => x.Id == id,
            cancellationToken);
        if (meeting is null || !CanView(meeting, user.Id)) return NotFound();
        if (meeting.Status == "cancelled")
            return Conflict(new { message = "Cancelled meetings cannot receive responses." });
        var participant = meeting.Participants.SingleOrDefault(x =>
            x.UserId == user.Id);
        if (participant is null)
            return StatusCode(403, new { message = "The organizer cannot respond to their own meeting." });

        if (participant.ResponseStatus != response)
        {
            participant.ResponseStatus = response;
            participant.RespondedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
        }
        return Ok(ToDto(meeting, user.Id));
    }

    private async Task<ChatUser?> FindUser(string username,
        CancellationToken cancellationToken) =>
        await db.Users.SingleOrDefaultAsync(x =>
            x.NormalizedUsername == Username.Normalize(username) &&
            x.Status == "active", cancellationToken);

    private IQueryable<ScheduledMeeting> ReadQuery() =>
        db.ScheduledMeetings.AsNoTracking()
            .Include(x => x.OrganizerUser)
            .Include(x => x.Participants).ThenInclude(x => x.User)
            .AsSplitQuery();

    private IQueryable<ScheduledMeeting> WriteQuery() =>
        db.ScheduledMeetings
            .Include(x => x.OrganizerUser)
            .Include(x => x.Participants).ThenInclude(x => x.User)
            .AsSplitQuery();

    private static bool CanView(ScheduledMeeting meeting, Guid userId) =>
        meeting.OrganizerUserId == userId ||
        meeting.Participants.Any(x => x.UserId == userId);

    private async Task LockConversationCreation(Guid meetingId,
        CancellationToken cancellationToken)
    {
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = db.Database.CurrentTransaction!.GetDbTransaction();
        command.CommandText =
            "DECLARE @result int; " +
            "EXEC @result = sp_getapplock @Resource = @resource, " +
            "@LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000; " +
            "SELECT @result;";
        var parameter = command.CreateParameter();
        parameter.ParameterName = "@resource";
        parameter.Value = $"scheduled-meeting:{meetingId:N}";
        command.Parameters.Add(parameter);
        var result = Convert.ToInt32(await command.ExecuteScalarAsync(
            cancellationToken));
        if (result < 0)
            throw new TimeoutException("Could not lock the meeting conversation.");
    }

    private static ConversationChanges SyncConversationMembers(
        ScheduledMeeting meeting, Conversation conversation)
    {
        var targetUsers = new[] { meeting.OrganizerUser }
            .Concat(meeting.Participants.Select(x => x.User))
            .Where(x => x.Status == "active")
            .DistinctBy(x => x.Id)
            .ToArray();
        var targetIds = targetUsers.Select(x => x.Id).ToHashSet();
        var added = new List<ChatUser>();
        var removed = new List<Guid>();

        foreach (var membership in conversation.Members)
        {
            if (targetIds.Contains(membership.UserId) || membership.LeftAt is not null)
                continue;
            membership.LeftAt = DateTimeOffset.UtcNow;
            membership.IsArchived = true;
            membership.UnreadCount = 0;
            removed.Add(membership.UserId);
        }

        foreach (var target in targetUsers)
        {
            var membership = conversation.Members.SingleOrDefault(x =>
                x.UserId == target.Id);
            if (membership is null)
            {
                conversation.Members.Add(new ConversationMember
                {
                    Conversation = conversation,
                    UserId = target.Id,
                    User = target,
                    Role = target.Id == meeting.OrganizerUserId ? "owner" : "member",
                });
                added.Add(target);
            }
            else if (membership.LeftAt is not null)
            {
                membership.LeftAt = null;
                membership.IsArchived = false;
                membership.Role = target.Id == meeting.OrganizerUserId
                    ? "owner" : "member";
                added.Add(target);
            }
        }

        return new ConversationChanges(added, removed, targetUsers.Length);
    }

    private async Task PublishConversationChanges(Guid conversationId,
        ConversationChanges changes, CancellationToken cancellationToken)
    {
        var groupName = ChatHub.ConversationGroup(conversationId);
        foreach (var userId in changes.Removed)
        {
            var connectionIds = presence.ConnectionIdsForUser(userId);
            foreach (var connectionId in connectionIds)
                await hubContext.Groups.RemoveFromGroupAsync(connectionId,
                    groupName, cancellationToken);
            if (connectionIds.Count > 0)
                await hubContext.Clients.Clients(connectionIds).SendAsync(
                    "ConversationRemoved", new ConversationRemovedDto(conversationId),
                    cancellationToken);
        }
        foreach (var user in changes.Added)
        {
            foreach (var connectionId in presence.ConnectionIdsForUser(user.Id))
                await hubContext.Groups.AddToGroupAsync(connectionId,
                    groupName, cancellationToken);
        }

        await hubContext.Clients.Group(groupName).SendAsync(
            "MembersChanged", new MembersChangedDto(conversationId,
                changes.MemberCount), cancellationToken);
        await hubContext.Clients.Group(groupName).SendAsync(
            "MeetingConversationChanged", cancellationToken: cancellationToken);
    }

    private static bool TryDate(string? value, out DateOnly date) =>
        DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture,
            DateTimeStyles.None, out date);

    private static bool TryTime(string? value, out TimeOnly time) =>
        TimeOnly.TryParseExact(value, "HH:mm", CultureInfo.InvariantCulture,
            DateTimeStyles.None, out time);

    private static (MeetingValues? Values, string? Error) Validate(
        SaveScheduledMeetingRequest request)
    {
        var title = request.Title?.Trim() ?? "";
        if (title.Length is < 2 or > 200)
            return (null, "Meeting titles must contain 2–200 characters.");
        var description = request.Description?.Trim();
        if (description?.Length > 4000)
            return (null, "Descriptions cannot exceed 4,000 characters.");
        if (!TryDate(request.StartDate, out var startDate) ||
            !TryDate(request.EndDate, out var endDate) || endDate < startDate ||
            endDate.DayNumber - startDate.DayNumber > 366)
            return (null, "Choose a valid date range of at most one year.");

        TimeOnly? startTime = null;
        TimeOnly? endTime = null;
        if (!request.AllDay)
        {
            if (!TryTime(request.Start, out var parsedStart) ||
                !TryTime(request.End, out var parsedEnd) ||
                (startDate == endDate && parsedEnd <= parsedStart))
                return (null, "Choose valid start and end times.");
            startTime = parsedStart;
            endTime = parsedEnd;
        }
        return (new MeetingValues(title, description, startDate, endDate,
            request.AllDay, startTime, endTime), null);
    }

    private async Task<(ChatUser[]? People, string? Error)> FindPeople(
        Guid[]? ids, Guid organizerId, CancellationToken cancellationToken)
    {
        var distinctIds = (ids ?? []).Distinct().ToArray();
        if (distinctIds.Length > 100)
            return (null, "A meeting can include at most 100 people.");
        if (distinctIds.Contains(organizerId))
            return (null, "The organizer is included automatically.");
        var people = await db.Users.Where(x =>
            distinctIds.Contains(x.Id) && x.Status == "active")
            .ToArrayAsync(cancellationToken);
        if (people.Length != distinctIds.Length)
            return (null, "Select active users from the people search results.");
        return (people, null);
    }

    private static string ScheduleSummary(ScheduledMeeting meeting)
    {
        var date = meeting.StartDate.ToString("MMM d, yyyy", CultureInfo.InvariantCulture);
        if (meeting.StartDate != meeting.EndDate)
            date += " – " + meeting.EndDate.ToString("MMM d, yyyy", CultureInfo.InvariantCulture);
        return meeting.IsAllDay ? date + " · All day" :
            date + " · " + meeting.StartTime?.ToString("HH:mm", CultureInfo.InvariantCulture) +
            "–" + meeting.EndTime?.ToString("HH:mm", CultureInfo.InvariantCulture);
    }

    private static ScheduledMeetingDto ToDto(ScheduledMeeting meeting,
        Guid viewerId) => new(
        meeting.Id,
        meeting.Title,
        meeting.Description ?? "",
        meeting.StartDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        meeting.EndDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        meeting.IsAllDay,
        meeting.StartTime?.ToString("HH:mm", CultureInfo.InvariantCulture),
        meeting.EndTime?.ToString("HH:mm", CultureInfo.InvariantCulture),
        meeting.Status,
        meeting.OrganizerUserId,
        meeting.OrganizerUser.DisplayName,
        meeting.OrganizerUser.Username,
        meeting.OrganizerUserId == viewerId,
        meeting.Participants.SingleOrDefault(x => x.UserId == viewerId)
            ?.ResponseStatus,
        meeting.Participants
            .OrderBy(x => x.User.DisplayName)
            .Select(x => new MeetingPersonDto(x.UserId, x.User.DisplayName,
                x.User.Username, x.ResponseStatus, x.RespondedAt))
            .ToArray(),
        meeting.CreatedAt,
        meeting.UpdatedAt,
        meeting.CancelledAt);
}

public sealed record SaveScheduledMeetingRequest(
    string? Title,
    string? Description,
    string? StartDate,
    string? EndDate,
    bool AllDay,
    string? Start,
    string? End,
    Guid[]? People);

public sealed record MeetingPersonDto(Guid Id, string DisplayName,
    string Username, string ResponseStatus, DateTimeOffset? RespondedAt);

public sealed record MeetingResponseRequest(string? Response);

public sealed record MeetingConversationDto(Guid ConversationId);

public sealed record MeetingManagePageDto(
    ScheduledMeetingDto[] Items, bool HasMore);

public sealed record ScheduledMeetingDto(
    Guid Id,
    string Title,
    string Description,
    string StartDate,
    string EndDate,
    bool AllDay,
    string? Start,
    string? End,
    string Status,
    Guid OrganizerId,
    string OrganizerDisplayName,
    string OrganizerUsername,
    bool CanEdit,
    string? ViewerResponseStatus,
    IReadOnlyList<MeetingPersonDto> People,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? CancelledAt);

internal sealed record MeetingValues(string Title, string? Description,
    DateOnly StartDate, DateOnly EndDate, bool AllDay,
    TimeOnly? StartTime, TimeOnly? EndTime);

internal sealed record ConversationChanges(
    IReadOnlyList<ChatUser> Added,
    IReadOnlyList<Guid> Removed,
    int MemberCount);
