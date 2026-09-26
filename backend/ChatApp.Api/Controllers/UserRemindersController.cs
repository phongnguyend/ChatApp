using ChatApp.Api.Services;
using ChatApp.Persistence;
using ChatApp.Domain.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/user-reminders")]
public sealed class UserRemindersController(ChatAppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string username,
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] string? name, [FromQuery] string? description,
        CancellationToken ct)
    {
        var userId = await FindUserId(username, ct);
        if (userId is null) return NotFound();
        if (from > to)
            return BadRequest(new { message = "The end date must be on or after the start date." });
        name = name?.Trim();
        description = description?.Trim();
        if (name?.Length > 200 || description?.Length > 200)
            return BadRequest(new { message = "A reminder search term is too long." });
        var query = db.UserReminders.AsNoTracking().Where(x => x.UserId == userId);
        if (from is { } first)
            query = query.Where(x => x.ReminderDate >= first);
        if (to is { } last)
            query = query.Where(x => x.ReminderDate <= last);
        if (!string.IsNullOrEmpty(name))
            query = query.Where(x => x.Title.Contains(name));
        if (!string.IsNullOrEmpty(description))
            query = query.Where(x => x.Description != null &&
                x.Description.Contains(description));
        var reminders = await query.OrderBy(x => x.ReminderDate)
            .ThenBy(x => x.ReminderTime == null)
            .ThenBy(x => x.ReminderTime)
            .ThenBy(x => x.Id)
            .ToListAsync(ct);
        return Ok(reminders.Select(ToDto).ToArray());
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id, [FromQuery] string username,
        CancellationToken ct)
    {
        var userId = await FindUserId(username, ct);
        if (userId is null) return NotFound();
        var reminder = await db.UserReminders.AsNoTracking()
            .SingleOrDefaultAsync(x => x.Id == id && x.UserId == userId, ct);
        return reminder is null ? NotFound() : Ok(ToDto(reminder));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromQuery] string username,
        SaveUserReminderRequest request, CancellationToken ct)
    {
        var userId = await FindUserId(username, ct);
        if (userId is null) return NotFound();
        var error = Validate(request);
        if (error is not null) return BadRequest(new { message = error });
        var reminder = new UserReminder
        {
            UserId = userId.Value,
            Title = request.Title!.Trim(),
            Description = CleanDescription(request.Description),
            ReminderDate = request.ReminderDate!.Value,
            ReminderTime = request.ReminderTime,
        };
        db.UserReminders.Add(reminder);
        await db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(GetById),
            new { id = reminder.Id, username }, ToDto(reminder));
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromQuery] string username,
        SaveUserReminderRequest request, CancellationToken ct)
    {
        var userId = await FindUserId(username, ct);
        if (userId is null) return NotFound();
        var error = Validate(request);
        if (error is not null) return BadRequest(new { message = error });
        var reminder = await db.UserReminders.SingleOrDefaultAsync(
            x => x.Id == id && x.UserId == userId, ct);
        if (reminder is null) return NotFound();
        reminder.Title = request.Title!.Trim();
        reminder.Description = CleanDescription(request.Description);
        reminder.ReminderDate = request.ReminderDate!.Value;
        reminder.ReminderTime = request.ReminderTime;
        reminder.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return Ok(ToDto(reminder));
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, [FromQuery] string username,
        CancellationToken ct)
    {
        var userId = await FindUserId(username, ct);
        if (userId is null) return NotFound();
        var reminder = await db.UserReminders.SingleOrDefaultAsync(
            x => x.Id == id && x.UserId == userId, ct);
        if (reminder is null) return NotFound();
        db.UserReminders.Remove(reminder);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task<Guid?> FindUserId(string? username, CancellationToken ct) =>
        await db.Users.Where(x => x.NormalizedUserName == Username.Normalize(username) &&
                x.Status == "active")
            .Select(x => (Guid?)x.Id).SingleOrDefaultAsync(ct);

    private static string? Validate(SaveUserReminderRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Trim().Length > 200)
            return "Enter a title of at most 200 characters.";
        if (request.Description?.Trim().Length > 4000)
            return "Description must be at most 4,000 characters.";
        if (request.ReminderDate is null || request.ReminderDate == default(DateOnly))
            return "Choose a reminder date.";
        return null;
    }

    private static string? CleanDescription(string? description) =>
        string.IsNullOrWhiteSpace(description) ? null : description.Trim();

    private static UserReminderDto ToDto(UserReminder reminder) => new(
        reminder.Id, reminder.Title, reminder.Description,
        reminder.ReminderDate, reminder.ReminderTime,
        reminder.CreatedAt, reminder.UpdatedAt);
}

public sealed record SaveUserReminderRequest(string? Title, string? Description,
    DateOnly? ReminderDate, TimeOnly? ReminderTime);
public sealed record UserReminderDto(Guid Id, string Title, string? Description,
    DateOnly ReminderDate, TimeOnly? ReminderTime,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
