using System.Security.Claims;
using System.Security.Cryptography;
using ChatApp.Application.Calendars;
using ChatApp.Domain.Models;
using ChatApp.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Endpoints;

public static class CalendarSharingEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/calendar").RequireAuthorization();

        group.AddEndpointFilter(async (context, next) =>
        {
            context.HttpContext.Response.Headers.CacheControl = "no-store";
            context.HttpContext.Response.Headers["Referrer-Policy"] = "no-referrer";
            context.HttpContext.Response.Headers["X-Content-Type-Options"] = "nosniff";
            return await next(context);
        });

        group.MapGet("/subscription", async (ChatAppDbContext db, ClaimsPrincipal user, CancellationToken ct) =>
        {
            var owner = await db.Users.AsNoTracking().SingleAsync(x => x.Id == UserId(user), ct);
            return Results.Ok(new { token = owner.CalendarFeedToken });
        });

        group.MapPost("/subscription", async (LinkRequest request, ChatAppDbContext db, ClaimsPrincipal user, CancellationToken ct) =>
        {
            if (!ValidAction(request.Action))
            {
                return Results.BadRequest(new { message = "Choose enable, regenerate, or disable." });
            }
            var owner = await db.Users.SingleAsync(x => x.Id == UserId(user), ct);
            var token = ChangeToken(owner.CalendarFeedToken, request.Action);
            await db.Users.Where(x => x.Id == owner.Id).ExecuteUpdateAsync(update => update.SetProperty(x => x.CalendarFeedToken, token), ct);
            return Results.Ok(new { token });
        });

        group.MapGet("/meetings/{id:guid}/share", async (Guid id, ChatAppDbContext db, ClaimsPrincipal user, CancellationToken ct) =>
        {
            var meeting = await db.ScheduledMeetings.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.OrganizerUserId == UserId(user), ct);
            return meeting is null ? Results.NotFound() : Results.Ok(new { token = meeting.ShareToken });
        });

        group.MapPost("/meetings/{id:guid}/share", async (Guid id, LinkRequest request, ChatAppDbContext db, ClaimsPrincipal user, CancellationToken ct) =>
        {
            if (!ValidAction(request.Action))
            {
                return Results.BadRequest(new { message = "Choose enable, regenerate, or disable." });
            }
            var meeting = await db.ScheduledMeetings.SingleOrDefaultAsync(x => x.Id == id && x.OrganizerUserId == UserId(user), ct);
            if (meeting is null)
            {
                return Results.NotFound();
            }
            var token = ChangeToken(meeting.ShareToken, request.Action);
            await db.ScheduledMeetings.Where(x => x.Id == id && x.OrganizerUserId == UserId(user))
                .ExecuteUpdateAsync(update => update.SetProperty(x => x.ShareToken, token), ct);
            return Results.Ok(new { token });
        });

        group.MapGet("/meetings/{id:guid}/calendar.ics", async (Guid id, ChatAppDbContext db, ClaimsPrincipal user, CancellationToken ct) =>
        {
            var userId = UserId(user);
            var meeting = await AccessibleMeetings(db).SingleOrDefaultAsync(x => x.Id == id &&
                (x.OrganizerUserId == userId || x.Participants.Any(p => p.UserId == userId)), ct);
            return meeting is null ? Results.NotFound() : Calendar([meeting], "event.ics");
        });

        group.MapGet("/events/{token}", async (string token, ChatAppDbContext db, CancellationToken ct) =>
        {
            var meeting = await SharedMeeting(db, token, ct);
            return meeting is null ? Results.NotFound() : Results.Ok(new
            {
                meeting.Title, description = meeting.Description ?? "", meeting.Status,
                startDate = meeting.StartDate.ToString("yyyy-MM-dd"), endDate = meeting.EndDate.ToString("yyyy-MM-dd"),
                start = meeting.StartTime?.ToString("HH:mm"), end = meeting.EndTime?.ToString("HH:mm"),
                allDay = meeting.IsAllDay, meeting.TimeZoneId,
                calendarStart = CalendarExport.EventTime(meeting, false, true),
                calendarEnd = CalendarExport.EventTime(meeting, true, true)
            });
        }).AllowAnonymous().RequireRateLimiting("calendar-reads");

        group.MapGet("/events/{token}/calendar.ics", async (string token, ChatAppDbContext db, CancellationToken ct) =>
        {
            var meeting = await SharedMeeting(db, token, ct);
            return meeting is null ? Results.NotFound() : Calendar([meeting], "event.ics");
        }).AllowAnonymous().RequireRateLimiting("calendar-reads");

        group.MapGet("/feeds/{token}/calendar.ics", async (string token, ChatAppDbContext db, CancellationToken ct) =>
        {
            if (!ValidToken(token))
            {
                return Results.NotFound();
            }
            var owner = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.CalendarFeedToken == token && x.IsEnabled && x.Status == "active", ct);
            if (owner is null)
            {
                return Results.NotFound();
            }
            var meetings = await AccessibleMeetings(db).Where(x => x.OrganizerUserId == owner.Id || x.Participants.Any(p => p.UserId == owner.Id))
                .OrderBy(x => x.StartDate).ThenBy(x => x.Id).ToArrayAsync(ct);
            return Calendar(meetings, "huddle-calendar.ics");
        }).AllowAnonymous().RequireRateLimiting("calendar-reads");
    }

    private static Guid UserId(ClaimsPrincipal user) => Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private static IQueryable<ScheduledMeeting> AccessibleMeetings(ChatAppDbContext db) => db.ScheduledMeetings.AsNoTracking()
        .Where(x => x.OrganizerUser.IsEnabled && x.OrganizerUser.Status == "active");

    private static async Task<ScheduledMeeting?> SharedMeeting(ChatAppDbContext db, string token, CancellationToken ct) =>
        ValidToken(token) ? await AccessibleMeetings(db).SingleOrDefaultAsync(x => x.ShareToken == token, ct) : null;

    private static bool ValidToken(string token) => token.Length == 64 && token.All(Uri.IsHexDigit);

    private static bool ValidAction(string action) => action is "enable" or "regenerate" or "disable";

    private static string? ChangeToken(string? current, string action) => action == "disable" ? null
        : action == "enable" && current is not null ? current : Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

    private static IResult Calendar(IEnumerable<ScheduledMeeting> meetings, string name) =>
        Results.File(CalendarExport.Write(meetings), "text/calendar; charset=utf-8", name);

    public sealed record LinkRequest(string Action);
}
