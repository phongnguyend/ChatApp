using System.Globalization;
using System.Text;
using ChatApp.Domain.Models;

namespace ChatApp.Application.Calendars;

public static class CalendarExport
{
    public static string? ValidateTimeZone(string? zoneId, DateOnly start, TimeOnly? startTime, DateOnly end, TimeOnly? endTime)
    {
        if (zoneId is null)
        {
            return null;
        }
        if (zoneId.Length is 0 or > 100 || !TimeZoneInfo.TryFindSystemTimeZoneById(zoneId, out var zone))
        {
            return "Choose a valid time zone.";
        }
        if (startTime is not null && endTime is not null)
        {
            var first = start.ToDateTime(startTime.Value);
            var last = end.ToDateTime(endTime.Value);
            if (zone.IsInvalidTime(first) || zone.IsInvalidTime(last))
            {
                return "This time does not exist because of daylight saving. Choose another time.";
            }
            if (Utc(first, zone) >= Utc(last, zone))
            {
                return "The end must be after the start in the selected time zone.";
            }
        }
        return null;
    }

    // RFC 5545 uses the first occurrence when a local clock time occurs twice.
    private static DateTimeOffset Utc(DateTime local, TimeZoneInfo zone) =>
        new DateTimeOffset(local, zone.IsAmbiguousTime(local) ? zone.GetAmbiguousTimeOffsets(local).Max() : zone.GetUtcOffset(local)).ToUniversalTime();

    public static string EventTime(ScheduledMeeting meeting, bool end, bool iso = false)
    {
        var date = end ? meeting.EndDate : meeting.StartDate;
        if (meeting.IsAllDay)
        {
            return (end ? date.AddDays(1) : date).ToString(iso ? "yyyy-MM-dd" : "yyyyMMdd", CultureInfo.InvariantCulture);
        }
        var local = date.ToDateTime((end ? meeting.EndTime : meeting.StartTime)!.Value);
        var format = iso ? "yyyy-MM-dd'T'HH:mm:ss" : "yyyyMMdd'T'HHmmss";
        return meeting.TimeZoneId is null ? local.ToString(format, CultureInfo.InvariantCulture)
            : Utc(local, TimeZoneInfo.FindSystemTimeZoneById(meeting.TimeZoneId)).ToString(format + "'Z'", CultureInfo.InvariantCulture);
    }

    public static byte[] Write(IEnumerable<ScheduledMeeting> meetings)
    {
        var output = new StringBuilder();
        void Line(string value)
        {
            var bytes = 0;
            foreach (var rune in value.EnumerateRunes())
            {
                if (bytes + rune.Utf8SequenceLength > 75)
                {
                    output.Append("\r\n ");
                    bytes = 1;
                }
                output.Append(rune.ToString());
                bytes += rune.Utf8SequenceLength;
            }
            output.Append("\r\n");
        }
        Line("BEGIN:VCALENDAR");
        Line("VERSION:2.0");
        Line("PRODID:-//Huddle//Calendar//EN");
        Line("CALSCALE:GREGORIAN");
        foreach (var meeting in meetings)
        {
            Line("BEGIN:VEVENT");
            Line($"UID:{meeting.Id:D}@huddle");
            Line("DTSTAMP:" + meeting.UpdatedAt.UtcDateTime.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture));
            Line("LAST-MODIFIED:" + meeting.UpdatedAt.UtcDateTime.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture));
            Line("SEQUENCE:" + meeting.CalendarSequence.ToString(CultureInfo.InvariantCulture));
            Line("SUMMARY:" + Escape(meeting.Title));
            Line("DESCRIPTION:" + Escape(meeting.Description ?? ""));
            Line("DTSTART" + (meeting.IsAllDay ? ";VALUE=DATE:" : ":") + EventTime(meeting, false));
            Line("DTEND" + (meeting.IsAllDay ? ";VALUE=DATE:" : ":") + EventTime(meeting, true));
            Line("STATUS:" + (meeting.Status == "cancelled" ? "CANCELLED" : "CONFIRMED"));
            Line("END:VEVENT");
        }
        Line("END:VCALENDAR");
        return Encoding.UTF8.GetBytes(output.ToString());
    }

    private static string Escape(string value) => value.Replace("\\", "\\\\").Replace("\r\n", "\n").Replace("\r", "\n")
        .Replace("\n", "\\n").Replace(";", "\\;").Replace(",", "\\,").Replace("\0", "");
}
