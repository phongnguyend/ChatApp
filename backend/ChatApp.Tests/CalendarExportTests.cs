using System.Text;
using ChatApp.Application.Calendars;
using ChatApp.Domain.Models;
using Xunit;

namespace ChatApp.Tests;

public class CalendarExportTests
{
    private static ScheduledMeeting Meeting() => new()
    {
        Id = Guid.Parse("11111111-1111-1111-1111-111111111111"),
        Title = "Planning",
        StartDate = new DateOnly(2026, 11, 18),
        EndDate = new DateOnly(2026, 11, 18),
        StartTime = new TimeOnly(9, 0),
        EndTime = new TimeOnly(10, 0),
        TimeZoneId = "Asia/Bangkok"
    };

    [Fact]
    public void TimedEventsUseUtcAndCancellationsKeepTheirIdentity()
    {
        var meeting = Meeting();
        var initial = Encoding.UTF8.GetString(CalendarExport.Write([meeting]));
        Assert.Contains("DTSTART:20261118T020000Z\r\n", initial);
        Assert.Contains("DTEND:20261118T030000Z\r\n", initial);
        meeting.Status = "cancelled";
        meeting.CalendarSequence = 2;
        var cancelled = Encoding.UTF8.GetString(CalendarExport.Write([meeting]));
        var uid = $"UID:{meeting.Id:D}@huddle\r\n";
        Assert.Contains(uid, initial);
        Assert.Contains(uid, cancelled);
        Assert.Contains("SEQUENCE:2\r\n", cancelled);
        Assert.Contains("STATUS:CANCELLED\r\n", cancelled);
    }

    [Fact]
    public void AllDayEndIsExclusiveAndLegacyTimesRemainFloating()
    {
        var meeting = Meeting();
        meeting.TimeZoneId = null;
        Assert.Equal("20261118T090000", CalendarExport.EventTime(meeting, false));
        meeting.IsAllDay = true;
        meeting.EndDate = new DateOnly(2026, 11, 20);
        var content = Encoding.UTF8.GetString(CalendarExport.Write([meeting]));
        Assert.Contains("DTSTART;VALUE=DATE:20261118\r\n", content);
        Assert.Contains("DTEND;VALUE=DATE:20261121\r\n", content);
    }

    [Fact]
    public void EscapesInjectionAndFoldsUnicodeAtUtf8OctetBoundary()
    {
        var meeting = Meeting();
        meeting.Title = string.Concat(Enumerable.Repeat("日本😀", 50));
        meeting.Description = "Agenda; a,b\\c\r\nEND:VEVENT\r\nBEGIN:VEVENT";
        var bytes = CalendarExport.Write([meeting]);
        var content = new UTF8Encoding(false, true).GetString(bytes);
        foreach (var line in content.Split("\r\n"))
        {
            Assert.True(Encoding.UTF8.GetByteCount(line) <= 75);
        }
        var unfolded = content.Replace("\r\n ", "");
        Assert.Contains("SUMMARY:" + meeting.Title, unfolded);
        Assert.Contains("DESCRIPTION:Agenda\\; a\\,b\\\\c\\nEND:VEVENT\\nBEGIN:VEVENT", unfolded);
        Assert.Equal(1, content.Split("\r\nBEGIN:VEVENT\r\n").Length - 1);
    }

    [Fact]
    public void RejectsInvalidZoneAndDstGapAndUsesFirstAmbiguousOccurrence()
    {
        var date = new DateOnly(2026, 3, 8);
        Assert.NotNull(CalendarExport.ValidateTimeZone("Not/AZone", date, new TimeOnly(2, 30), date, new TimeOnly(3, 30)));
        Assert.NotNull(CalendarExport.ValidateTimeZone("America/New_York", date, new TimeOnly(2, 30), date, new TimeOnly(3, 30)));
        var meeting = Meeting();
        meeting.TimeZoneId = "America/New_York";
        meeting.StartDate = new DateOnly(2026, 11, 1);
        meeting.StartTime = new TimeOnly(1, 30);
        Assert.Equal("20261101T053000Z", CalendarExport.EventTime(meeting, false));
    }
}
