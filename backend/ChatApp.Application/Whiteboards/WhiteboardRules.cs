using System.Text.Json;
using System.Text.RegularExpressions;

namespace ChatApp.Application.Whiteboards;

public sealed record BoardPoint(double X, double Y);

public sealed record BoardObject
{
    public Guid Id { get; init; }

    public string Kind { get; init; } = "rectangle";

    public double X { get; init; }

    public double Y { get; init; }

    public double? Z { get; init; }

    public double Width { get; init; } = 100;

    public double Height { get; init; } = 100;

    public string Color { get; init; } = "#1f2937";

    public string Fill { get; init; } = "transparent";

    public double StrokeWidth { get; init; } = 3;

    public string Text { get; init; } = "";

    public int FontSize { get; init; } = 24;

    public BoardPoint[] Points { get; init; } = [];

    public Guid? ImageId { get; init; }

    public int Version { get; init; }

    public bool Deleted { get; init; }

    public bool Locked { get; init; }

    public Guid SheetId { get; init; }
}

public sealed record BoardEdit(int ExpectedVersion, BoardObject Object);

public sealed record BoardSheet(Guid Id, string Name);

public sealed record BoardDocument(BoardSheet[] Sheets, BoardObject[] Objects);

public sealed record BoardCommand(Guid OperationId, BoardEdit[] Edits, BoardSheet[]? Sheets = null, int? ExpectedRevision = null);

public static partial class WhiteboardRules
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static BoardSheet[] ReadSheets(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.ValueKind == JsonValueKind.Array
            ? [new BoardSheet(Guid.Empty, "Sheet 1")]
            : document.RootElement.GetProperty("sheets").Deserialize<BoardSheet[]>(Json)!;
    }

    public static BoardDocument ApplyDocument(string json, BoardCommand command, int revision)
    {
        var sheets = command.Sheets ?? ReadSheets(json);
        if (sheets.Length is < 1 or > 50 || sheets.Any(sheet => sheet is null || string.IsNullOrWhiteSpace(sheet.Name) || sheet.Name.Length > 50) ||
            sheets.Select(sheet => sheet.Id).Distinct().Count() != sheets.Length || sheets.Select(sheet => sheet.Name.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Count() != sheets.Length)
        {
            throw new ArgumentException("Use 1–50 sheets with unique names of 1–50 characters.");
        }
        if (command.Sheets is not null && command.ExpectedRevision != revision - 1)
        {
            throw new InvalidOperationException("The board changed. Reload before changing sheets.");
        }
        var previous = ReadDocument(json);
        var objects = Apply(previous, command, revision);
        if (command.Edits.Any(edit => !edit.Object.Deleted && !sheets.Any(sheet => sheet.Id == edit.Object.SheetId)))
        {
            throw new ArgumentException("Choose an existing sheet for each object.");
        }
        objects = objects.Select(item => !item.Deleted && !sheets.Any(sheet => sheet.Id == item.SheetId) ? item with { Deleted = true, Version = revision } : item).ToArray();
        var result = new BoardDocument(sheets.Select(sheet => sheet with { Name = sheet.Name.Trim() }).ToArray(), objects);
        if (JsonSerializer.SerializeToUtf8Bytes(result, Json).Length > 2000000)
        {
            throw new ArgumentException("This board has reached its 2 MB document limit.");
        }
        return result;
    }

    public static BoardObject[] ReadDocument(string json)
    {
        using var document = JsonDocument.Parse(json);
        var objects = document.RootElement.ValueKind == JsonValueKind.Array ? document.RootElement : document.RootElement.GetProperty("objects");
        return objects.EnumerateArray().Select((element, index) =>
        {
            var item = element.Deserialize<BoardObject>(Json)!;
            // Preserve layer order in documents and history saved before Z was renamed.
            if (!element.TryGetProperty("z", out _) && element.TryGetProperty("zIndex", out var legacyZ) && legacyZ.ValueKind == JsonValueKind.Number && legacyZ.TryGetDouble(out var value))
            {
                item = item with { Z = value };
            }
            return item with { Z = item.Z ?? index };
        }).ToArray();
    }

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex ColorPattern();

    public static bool Coordinate(double value) => double.IsFinite(value) && Math.Abs(value) <= 100000;

    public static bool Valid(BoardObject? item) => item is not null && item.Id != Guid.Empty &&
        item.Kind is "path" or "rectangle" or "ellipse" or "line" or "text" or "sticky" or "image" &&
        Coordinate(item.X) && Coordinate(item.Y) && (item.Z is null || double.IsFinite(item.Z.Value) && Math.Abs(item.Z.Value) <= 1e12) &&
        double.IsFinite(item.Width) && item.Width is >= 1 and <= 10000 &&
        double.IsFinite(item.Height) && item.Height is >= 1 and <= 10000 && item.Color is not null && ColorPattern().IsMatch(item.Color) &&
        item.Fill is not null && (item.Fill == "transparent" || ColorPattern().IsMatch(item.Fill)) &&
        double.IsFinite(item.StrokeWidth) && item.StrokeWidth is >= 1 and <= 40 && item.FontSize is >= 8 and <= 200 &&
        item.Text is not null && item.Text.Length <= 4000 && item.Points is not null && item.Points.Length <= 4000 &&
        item.Points.All(p => p is not null && Coordinate(p.X) && Coordinate(p.Y)) &&
        (item.Kind != "path" || item.Points.Length >= 1) && (item.Kind != "line" || item.Points.Length == 2) &&
        (item.Kind != "image" || item.ImageId is not null && item.ImageId != Guid.Empty);

    public static BoardObject[] Apply(BoardObject[] current, BoardCommand command, int revision)
    {
        if (command.OperationId == Guid.Empty || command.Edits is null || command.Edits.Length > 2000 || (command.Edits.Length == 0 && command.Sheets is null) ||
            command.Edits.Any(x => x is null || !Valid(x.Object)) || command.Edits.Select(x => x.Object.Id).Distinct().Count() != command.Edits.Length)
        {
            throw new ArgumentException("Invalid board command. Use up to 2,000 valid objects per edit.");
        }
        var objects = current.Select((item, index) => item with { Z = item.Z ?? index }).ToDictionary(x => x.Id);
        foreach (var edit in command.Edits)
        {
            var previous = objects.GetValueOrDefault(edit.Object.Id);
            if ((previous?.Version ?? 0) != edit.ExpectedVersion)
            {
                throw new InvalidOperationException("Another collaborator changed this object. Reload and try again.");
            }
            var z = edit.Object.Z ?? previous?.Z ?? (objects.Count == 0 ? 0 : objects.Values.Max(x => x.Z!.Value) + 1);
            if (Math.Abs(z) > 1e12)
            {
                throw new ArgumentException("This object exceeds the supported layer range.");
            }
            objects[edit.Object.Id] = edit.Object with { Version = revision, Z = z };
        }
        var result = objects.Values.ToArray();
        if (result.Length > 2000 || JsonSerializer.SerializeToUtf8Bytes(result, Json).Length > 2000000)
        {
            throw new ArgumentException("This board has reached its 2,000-object or 2 MB document limit.");
        }
        return result;
    }
}
