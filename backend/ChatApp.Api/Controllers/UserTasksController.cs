using System.Data;
using ChatApp.Persistence;
using ChatApp.Domain.Models;
using ChatApp.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatApp.Api.Controllers;

[ApiController]
[Route("api/user-tasks")]
public sealed class UserTasksController(ChatAppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string username,
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null) return NotFound();
        if (from.HasValue != to.HasValue)
            return BadRequest(new { message = "Choose a valid date range of at most one year." });
        var query = ReadQuery().Where(x => x.UserId == user.Id ||
            x.Shares.Any(share => share.GranteeUserId == user.Id));
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
        return Ok(tasks.Select(x => ToDto(x, user.Id)).ToArray());
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromQuery] string username,
        SaveUserTaskRequest request, CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null) return NotFound();
        var error = Validate(request);
        if (error is not null) return BadRequest(new { message = error });
        var task = new UserTask
        {
            UserId = user.Id,
            User = user,
            Title = request.Title.Trim(),
            Description = CleanDescription(request.Description),
            DueDate = request.DueDate,
            Priority = request.Priority,
        };
        db.UserTasks.Add(task);
        await db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(List), new { username }, ToDto(task, user.Id));
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromQuery] string username,
        SaveUserTaskRequest request, CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null) return NotFound();
        var error = Validate(request);
        if (error is not null) return BadRequest(new { message = error });
        var task = await WriteQuery().SingleOrDefaultAsync(
            x => x.Id == id && (x.UserId == user.Id ||
                x.Shares.Any(share => share.GranteeUserId == user.Id &&
                    share.Permission == "editor")), ct);
        if (task is null) return NotFound();
        task.Title = request.Title.Trim();
        task.Description = CleanDescription(request.Description);
        task.DueDate = request.DueDate;
        task.Priority = request.Priority;
        task.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return Ok(ToDto(task, user.Id));
    }

    [HttpPatch("{id:guid}/completion")]
    public async Task<IActionResult> SetCompletion(Guid id, [FromQuery] string username,
        SetUserTaskCompletionRequest request, CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null) return NotFound();
        var task = await WriteQuery().SingleOrDefaultAsync(
            x => x.Id == id && (x.UserId == user.Id ||
                x.Shares.Any(share => share.GranteeUserId == user.Id &&
                    (share.Permission == "editor" || x.AssigneeUserId == user.Id))), ct);
        if (task is null) return NotFound();
        task.IsCompleted = request.IsCompleted;
        task.CompletedAt = request.IsCompleted ? DateTimeOffset.UtcNow : null;
        task.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return Ok(ToDto(task, user.Id));
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, [FromQuery] string username,
        CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null) return NotFound();
        var task = await db.UserTasks.SingleOrDefaultAsync(
            x => x.Id == id && x.UserId == user.Id, ct);
        if (task is null) return NotFound();
        db.UserTasks.Remove(task);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPatch("{id:guid}/assignee")]
    public async Task<IActionResult> SetAssignee(Guid id, [FromQuery] string username,
        SetUserTaskAssigneeRequest request, CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null) return NotFound();
        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable, ct);
        var task = await WriteQuery().SingleOrDefaultAsync(
            x => x.Id == id && x.UserId == user.Id, ct);
        if (task is null) return NotFound();
        var previousAssigneeId = task.AssigneeUserId;
        if (request.AssigneeUserId is { } assigneeId)
        {
            if (assigneeId != user.Id &&
                !task.Shares.Any(x => x.GranteeUserId == assigneeId))
                return BadRequest(new { message = "Choose yourself or a person in the task's sharing list." });
            task.AssigneeUser = assigneeId == user.Id ? user :
                await db.Users.SingleOrDefaultAsync(x =>
                    x.Id == assigneeId && x.Status == "active", ct);
            if (task.AssigneeUser is null)
                return BadRequest(new { message = "Choose an active person." });
            task.AssigneeUserId = assigneeId;
        }
        else
        {
            task.AssigneeUserId = null;
            task.AssigneeUser = null;
        }
        if (task.AssigneeUserId is { } newAssigneeId &&
            newAssigneeId != user.Id && newAssigneeId != previousAssigneeId)
            db.UserNotifications.Add(new UserNotification
            {
                UserId = newAssigneeId,
                ActorUserId = user.Id,
                Type = "task_assignment",
                TargetId = task.Id,
                TargetTitle = task.Title,
            });
        task.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Ok(ToDto(task, user.Id));
    }

    [HttpGet("{id:guid}/assignees")]
    public async Task<IActionResult> GetAssignees(Guid id, [FromQuery] string username,
        CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null || !await db.UserTasks.AnyAsync(
                x => x.Id == id && x.UserId == user.Id, ct)) return NotFound();
        var shared = await db.UserTaskShares.AsNoTracking()
            .Where(x => x.TaskId == id && x.GranteeUser.Status == "active")
            .OrderBy(x => (((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim() == "" ? x.GranteeUser.UserName : ((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim()))
            .Select(x => new UserTaskAssigneeCandidateDto(x.GranteeUserId,
                x.GranteeUser.UserName, (((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim() == "" ? x.GranteeUser.UserName : ((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim())))
            .ToListAsync(ct);
        shared.Insert(0, new UserTaskAssigneeCandidateDto(user.Id,
            user.UserName, user.DisplayName));
        return Ok(shared);
    }

    [HttpGet("{id:guid}/shares")]
    public async Task<IActionResult> GetShares(Guid id, [FromQuery] string username,
        CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null || !await db.UserTasks.AnyAsync(
                x => x.Id == id && x.UserId == user.Id, ct)) return NotFound();
        var shares = await db.UserTaskShares.AsNoTracking()
            .Where(x => x.TaskId == id)
            .OrderBy(x => (((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim() == "" ? x.GranteeUser.UserName : ((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim()))
            .Select(x => new UserTaskShareDto(x.Id, x.GranteeUserId, x.GranteeUser.UserName,
                (((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim() == "" ? x.GranteeUser.UserName : ((x.GranteeUser.FirstName ?? "") + " " + (x.GranteeUser.LastName ?? "")).Trim()), x.Permission))
            .ToListAsync(ct);
        return Ok(shares);
    }

    [HttpPut("{id:guid}/shares")]
    public async Task<IActionResult> PutShare(Guid id, [FromQuery] string username,
        SaveUserTaskShareRequest request, CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null) return NotFound();
        if (request.Permission is not ("viewer" or "editor"))
            return BadRequest(new { message = "Choose Viewer or Editor." });
        if (!await db.UserTasks.AnyAsync(x => x.Id == id && x.UserId == user.Id, ct))
            return NotFound();
        var grantee = await FindUser(request.RecipientUsername, ct);
        if (grantee is null) return BadRequest(new { message = "Choose an active person." });
        if (grantee.Id == user.Id)
            return BadRequest(new { message = "You already own this task." });

        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable, ct);
        var share = await db.UserTaskShares.SingleOrDefaultAsync(x =>
            x.TaskId == id && x.GranteeUserId == grantee.Id, ct);
        if (share is null)
        {
            share = new UserTaskShare
            {
                TaskId = id,
                GranteeUserId = grantee.Id,
                Permission = request.Permission,
            };
            db.UserTaskShares.Add(share);
            var taskTitle = await db.UserTasks.Where(x => x.Id == id)
                .Select(x => x.Title).SingleAsync(ct);
            db.UserNotifications.Add(new UserNotification
            {
                UserId = grantee.Id,
                ActorUserId = user.Id,
                Type = "task_share",
                TargetId = id,
                TargetTitle = taskTitle,
            });
        }
        else share.Permission = request.Permission;
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Ok(new UserTaskShareDto(share.Id, grantee.Id, grantee.UserName,
            grantee.DisplayName, share.Permission));
    }

    [HttpDelete("{id:guid}/shares/{shareId:guid}")]
    public async Task<IActionResult> RemoveShare(Guid id, Guid shareId,
        [FromQuery] string username, CancellationToken ct)
    {
        var user = await FindUser(username, ct);
        if (user is null) return NotFound();
        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.Serializable, ct);
        var share = await db.UserTaskShares.SingleOrDefaultAsync(x =>
            x.Id == shareId && x.TaskId == id && x.Task.UserId == user.Id, ct);
        if (share is null) return NotFound();
        var task = await db.UserTasks.SingleAsync(x => x.Id == id, ct);
        if (task.AssigneeUserId == share.GranteeUserId)
        {
            task.AssigneeUserId = null;
            task.UpdatedAt = DateTimeOffset.UtcNow;
        }
        db.UserTaskShares.Remove(share);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return NoContent();
    }

    private async Task<ChatUser?> FindUser(string? username, CancellationToken ct) =>
        await db.Users.SingleOrDefaultAsync(x =>
            x.NormalizedUserName == Username.Normalize(username) &&
            x.Status == "active", ct);

    private IQueryable<UserTask> ReadQuery() => db.UserTasks.AsNoTracking()
        .Include(x => x.User).Include(x => x.Shares).Include(x => x.AssigneeUser);

    private IQueryable<UserTask> WriteQuery() => db.UserTasks
        .Include(x => x.User).Include(x => x.Shares).Include(x => x.AssigneeUser);

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

    private static UserTaskDto ToDto(UserTask task, Guid userId) => new(
        task.Id, task.Title, task.Description, task.DueDate, task.Priority,
        task.IsCompleted, task.CompletedAt, task.CreatedAt, task.UpdatedAt,
        task.User.Id, task.User.UserName, task.User.DisplayName,
        task.UserId == userId ? "owner" :
            task.Shares.Single(x => x.GranteeUserId == userId).Permission,
        task.UserId == userId ? task.Shares.Count : 0,
        task.AssigneeUserId, task.AssigneeUser?.UserName,
        task.AssigneeUser?.DisplayName);
}

public sealed record SaveUserTaskRequest(string Title, string? Description,
    DateOnly? DueDate, string Priority);
public sealed record SetUserTaskCompletionRequest(bool IsCompleted);
public sealed record SetUserTaskAssigneeRequest(Guid? AssigneeUserId);
public sealed record UserTaskAssigneeCandidateDto(Guid UserId, string Username,
    string DisplayName);
public sealed record SaveUserTaskShareRequest(string RecipientUsername,
    string Permission);
public sealed record UserTaskShareDto(Guid Id, Guid UserId, string Username,
    string DisplayName, string Permission);
public sealed record UserTaskDto(Guid Id, string Title, string? Description,
    DateOnly? DueDate, string Priority, bool IsCompleted,
    DateTimeOffset? CompletedAt, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
    Guid OwnerUserId, string OwnerUsername, string OwnerDisplayName, string Permission,
    int ShareCount, Guid? AssigneeUserId, string? AssigneeUsername,
    string? AssigneeDisplayName);
