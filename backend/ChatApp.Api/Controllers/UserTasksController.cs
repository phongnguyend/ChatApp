using ChatApp.Application.Contracts;
using ChatApp.Application.Data;
using ChatApp.Application.Models;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/user-tasks")]
public sealed class UserTasksController(ChatDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string username,
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        var userId = await FindUserId(username, ct);
        if (userId is null) return NotFound();
        if (from.HasValue != to.HasValue)
            return BadRequest(new { message = "Choose a valid date range of at most one year." });
        var query = db.UserTasks.AsNoTracking().Where(x => x.UserId == userId);
        if (from is { } start && to is { } end)
        {
            if (end < start || end.DayNumber - start.DayNumber > 366)
                return BadRequest(new { message = "Choose a valid date range of at most one year." });
            query = query.Where(x => x.DueDate >= start && x.DueDate <= end);
        }
        var tasks = await query
            .OrderBy(x => x.IsCompleted)
            .ThenBy(x => x.DueDate == null)
            .ThenBy(x => x.DueDate)
            .ThenByDescending(x => x.CreatedAt)
            .ToListAsync(ct);
        return Ok(tasks.Select(ToDto).ToArray());
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromQuery] string username,
        SaveUserTaskRequest request, CancellationToken ct)
    {
        var userId = await FindUserId(username, ct);
        if (userId is null) return NotFound();
        var error = Validate(request);
        if (error is not null) return BadRequest(new { message = error });
        var task = new UserTask
        {
            UserId = userId.Value,
            Title = request.Title.Trim(),
            Description = CleanDescription(request.Description),
            DueDate = request.DueDate,
            Priority = request.Priority,
        };
        db.UserTasks.Add(task);
        await db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(List), new { username }, ToDto(task));
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromQuery] string username,
        SaveUserTaskRequest request, CancellationToken ct)
    {
        var userId = await FindUserId(username, ct);
        if (userId is null) return NotFound();
        var error = Validate(request);
        if (error is not null) return BadRequest(new { message = error });
        var task = await db.UserTasks.SingleOrDefaultAsync(
            x => x.Id == id && x.UserId == userId, ct);
        if (task is null) return NotFound();
        task.Title = request.Title.Trim();
        task.Description = CleanDescription(request.Description);
        task.DueDate = request.DueDate;
        task.Priority = request.Priority;
        task.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return Ok(ToDto(task));
    }

    [HttpPatch("{id:guid}/completion")]
    public async Task<IActionResult> SetCompletion(Guid id, [FromQuery] string username,
        SetUserTaskCompletionRequest request, CancellationToken ct)
    {
        var userId = await FindUserId(username, ct);
        if (userId is null) return NotFound();
        var task = await db.UserTasks.SingleOrDefaultAsync(
            x => x.Id == id && x.UserId == userId, ct);
        if (task is null) return NotFound();
        task.IsCompleted = request.IsCompleted;
        task.CompletedAt = request.IsCompleted ? DateTimeOffset.UtcNow : null;
        task.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return Ok(ToDto(task));
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, [FromQuery] string username,
        CancellationToken ct)
    {
        var userId = await FindUserId(username, ct);
        if (userId is null) return NotFound();
        var task = await db.UserTasks.SingleOrDefaultAsync(
            x => x.Id == id && x.UserId == userId, ct);
        if (task is null) return NotFound();
        db.UserTasks.Remove(task);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task<Guid?> FindUserId(string username, CancellationToken ct) =>
        await db.Users.Where(x => x.NormalizedUsername == Username.Normalize(username)
                && x.Status == "active")
            .Select(x => (Guid?)x.Id).SingleOrDefaultAsync(ct);

    private static string? Validate(SaveUserTaskRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Trim().Length > 200)
            return "Enter a title of at most 200 characters.";
        if (request.Description?.Trim().Length > 4000)
            return "Notes must be at most 4,000 characters.";
        if (request.Priority is not ("low" or "normal" or "high"))
            return "Choose a valid priority.";
        return null;
    }

    private static string? CleanDescription(string? description) =>
        string.IsNullOrWhiteSpace(description) ? null : description.Trim();

    private static UserTaskDto ToDto(UserTask task) => new(
        task.Id, task.Title, task.Description, task.DueDate, task.Priority,
        task.IsCompleted, task.CompletedAt, task.CreatedAt, task.UpdatedAt);
}

public sealed record SaveUserTaskRequest(string Title, string? Description,
    DateOnly? DueDate, string Priority);
public sealed record SetUserTaskCompletionRequest(bool IsCompleted);
public sealed record UserTaskDto(Guid Id, string Title, string? Description,
    DateOnly? DueDate, string Priority, bool IsCompleted,
    DateTimeOffset? CompletedAt, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
