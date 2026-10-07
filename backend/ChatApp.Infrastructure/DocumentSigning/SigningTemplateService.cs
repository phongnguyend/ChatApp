using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ChatApp.Persistence;
using ChatApp.Domain.Models;

namespace ChatApp.Infrastructure.DocumentSigning;

public sealed record SigningTemplateInput(string Name, SigningField[] Fields, int PageCount);

public sealed record SigningTemplateRenameInput(string Name);

public sealed record SigningTemplateSummary(Guid Id, string Name, int FieldCount, int PageCount, DateTimeOffset UpdatedAtUtc);

public sealed record SigningTemplateView(Guid Id, string Name, int PageCount, SigningField[] Fields, DateTimeOffset UpdatedAtUtc);

/// <summary>
/// Personal, reusable field layouts for in-app signing. Templates hold positions only: drawn signatures
/// and typed values are always stripped so a template can never carry someone's signature.
/// </summary>
public sealed class SigningTemplateService(ChatAppDbContext db)
{
    public const int MaxTemplatesPerUser = 100;

    public async Task<List<SigningTemplateSummary>> ListAsync(Guid userId, CancellationToken ct)
    {
        return await db.SigningTemplates.AsNoTracking().Where(x => x.CreatedById == userId)
            .OrderBy(x => x.Name)
            .Select(x => new SigningTemplateSummary(x.Id, x.Name, x.FieldCount, x.PageCount, x.UpdatedAtUtc))
            .ToListAsync(ct);
    }

    public async Task<SigningTemplateView> GetAsync(Guid id, Guid userId, CancellationToken ct)
    {
        var row = await db.SigningTemplates.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.CreatedById == userId, ct)
            ?? throw new KeyNotFoundException("Template not found.");
        return View(row);
    }

    public async Task<SigningTemplateView> CreateAsync(Guid userId, SigningTemplateInput input, CancellationToken ct)
    {
        var (name, fields) = Normalize(input);
        if (await db.SigningTemplates.CountAsync(x => x.CreatedById == userId, ct) >= MaxTemplatesPerUser)
        {
            throw new InvalidOperationException($"You can keep at most {MaxTemplatesPerUser} templates. Delete one before saving another.");
        }
        await EnsureNameAvailableAsync(db, userId, name, null, ct);
        var now = DateTimeOffset.UtcNow;
        var row = new SigningTemplateEntity
        {
            CreatedById = userId,
            Name = name,
            FieldsJson = JsonSerializer.Serialize(fields),
            FieldCount = fields.Length,
            PageCount = input.PageCount,
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        };
        db.SigningTemplates.Add(row);
        await db.SaveChangesAsync(ct);
        return View(row);
    }

    public async Task<SigningTemplateView> UpdateAsync(Guid id, Guid userId, SigningTemplateInput input, CancellationToken ct)
    {
        var (name, fields) = Normalize(input);
        var row = await db.SigningTemplates.SingleOrDefaultAsync(x => x.Id == id && x.CreatedById == userId, ct)
            ?? throw new KeyNotFoundException("Template not found.");
        await EnsureNameAvailableAsync(db, userId, name, id, ct);
        row.Name = name;
        row.FieldsJson = JsonSerializer.Serialize(fields);
        row.FieldCount = fields.Length;
        row.PageCount = input.PageCount;
        row.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return View(row);
    }

    public async Task<SigningTemplateView> RenameAsync(Guid id, Guid userId, SigningTemplateRenameInput input, CancellationToken ct)
    {
        var name = NormalizeName(input?.Name);
        var row = await db.SigningTemplates.SingleOrDefaultAsync(x => x.Id == id && x.CreatedById == userId, ct)
            ?? throw new KeyNotFoundException("Template not found.");
        await EnsureNameAvailableAsync(db, userId, name, id, ct);
        row.Name = name;
        row.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return View(row);
    }

    public async Task DeleteAsync(Guid id, Guid userId, CancellationToken ct)
    {
        var deleted = await db.SigningTemplates.Where(x => x.Id == id && x.CreatedById == userId).ExecuteDeleteAsync(ct);
        if (deleted == 0)
        {
            throw new KeyNotFoundException("Template not found.");
        }
    }

    public static (string Name, SigningField[] Fields) Normalize(SigningTemplateInput? input)
    {
        var name = NormalizeName(input?.Name);
        if (input!.Fields is null || input.Fields.Length == 0)
        {
            throw new ArgumentException("Add at least one field before saving a template.");
        }
        if (input.PageCount is < 1 or > 10_000)
        {
            throw new ArgumentException("The template page count must be between 1 and 10,000.");
        }
        var fields = input.Fields.Select(x => x is null ? null! : x with { Value = null }).ToArray();
        InAppSigning.Validate(fields, requireValues: false);
        if (fields.Any(x => x.Page > input.PageCount))
        {
            throw new ArgumentException("Every template field must be on a page within the document.");
        }
        return (name, fields);
    }

    public static string NormalizeName(string? value)
    {
        var name = value?.Trim() ?? "";
        if (name.Length is < 1 or > 100 || name.Any(char.IsControl))
        {
            throw new ArgumentException("Template names must be 1–100 characters on a single line.");
        }
        return name;
    }

    private static async Task EnsureNameAvailableAsync(ChatAppDbContext db, Guid userId, string name, Guid? exceptId, CancellationToken ct)
    {
        // SQL Server's default collation compares names case-insensitively, matching the unique index.
        var taken = await db.SigningTemplates.AnyAsync(x => x.CreatedById == userId && x.Name == name && x.Id != exceptId, ct);
        if (taken)
        {
            throw new ArgumentException($"You already have a template named \"{name}\". Choose another name or update that template.");
        }
    }

    private static SigningTemplateView View(SigningTemplateEntity row) =>
        new(row.Id, row.Name, row.PageCount, JsonSerializer.Deserialize<SigningField[]>(row.FieldsJson) ?? [], row.UpdatedAtUtc);
}
