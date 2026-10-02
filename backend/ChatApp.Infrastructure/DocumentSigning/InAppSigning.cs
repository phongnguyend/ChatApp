using System.Text.RegularExpressions;

namespace ChatApp.Infrastructure.DocumentSigning;

/// <summary>
/// A field placed on a PDF page. Coordinates are fractions of the displayed page (top-left origin),
/// so the layout is independent of zoom and the client's rendering size.
/// </summary>
public sealed record SigningField(string Id, string Type, int Page, double X, double Y, double Width, double Height, string? Value);

public sealed record SigningFieldsInput(SigningField[] Fields);

public sealed record SigningFieldsView(string Status, SigningField[] Fields);

public static partial class InAppSigning
{
    public const string Provider = "InApp";

    public const string Draft = "Draft";

    public const string Completed = "completed";

    public const int MaxFields = 500;

    public const int MaxImageValueLength = 400_000;

    public const int MaxTextValueLength = 500;

    public const int MaxTotalValueLength = 12_000_000;

    private static readonly string[] Types = ["signature", "initials", "date", "text"];

    public static bool IsImageField(string type) => type is "signature" or "initials";

    public static void Validate(SigningField[]? fields, bool requireValues)
    {
        if (fields is null || fields.Length > MaxFields)
        {
            throw new ArgumentException($"Provide at most {MaxFields} fields.");
        }
        if (fields.Any(x => x is null))
        {
            throw new ArgumentException("Fields cannot be empty.");
        }
        if (fields.Select(x => x.Id).Distinct(StringComparer.Ordinal).Count() != fields.Length)
        {
            throw new ArgumentException("Field identifiers must be unique.");
        }
        long total = 0;
        foreach (var field in fields)
        {
            if (string.IsNullOrEmpty(field.Id) || !FieldId().IsMatch(field.Id))
            {
                throw new ArgumentException("Field identifiers must be 1–64 letters, digits, hyphens, or underscores.");
            }
            if (!Types.Contains(field.Type))
            {
                throw new ArgumentException("Field type must be signature, initials, date, or text.");
            }
            if (field.Page is < 1 or > 10_000)
            {
                throw new ArgumentException("Field page numbers must be between 1 and 10,000.");
            }
            if (!Fraction(field.X) || !Fraction(field.Y) || !double.IsFinite(field.Width) || !double.IsFinite(field.Height)
                || field.Width < 0.005 || field.Height < 0.005 || field.X + field.Width > 1.0001 || field.Y + field.Height > 1.0001)
            {
                throw new ArgumentException("Fields must fit within their page.");
            }
            var value = field.Value;
            if (string.IsNullOrEmpty(value))
            {
                if (requireValues)
                {
                    throw new ArgumentException("Complete every field before finishing.");
                }
                continue;
            }
            total += value.Length;
            if (IsImageField(field.Type))
            {
                if (value.Length > MaxImageValueLength || !PngDataUrl(value))
                {
                    throw new ArgumentException("Signatures must be PNG images of at most 300 KB.");
                }
            }
            else if (value.Length > MaxTextValueLength || value.Any(char.IsControl))
            {
                throw new ArgumentException($"Date and text values must be at most {MaxTextValueLength} characters on a single line.");
            }
        }
        if (total > MaxTotalValueLength)
        {
            throw new ArgumentException("The signature fields are too large to save. Remove some fields and try again.");
        }
        if (requireValues && !fields.Any(x => IsImageField(x.Type)))
        {
            throw new ArgumentException("Add at least one signature or initials field before finishing.");
        }
    }

    private static bool Fraction(double value) => double.IsFinite(value) && value is >= 0 and <= 1;

    private static bool PngDataUrl(string value)
    {
        const string prefix = "data:image/png;base64,";
        if (!value.StartsWith(prefix, StringComparison.Ordinal))
        {
            return false;
        }
        var bytes = new byte[(value.Length - prefix.Length) * 3 / 4 + 3];
        return Convert.TryFromBase64String(value[prefix.Length..], bytes, out var written)
            && written > 8 && bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A });
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex FieldId();
}
