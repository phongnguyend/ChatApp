using System.Text.RegularExpressions;

namespace ChatApp.Api.Services;

public static partial class Username
{
    public static string Clean(string? value) => value?.Trim() ?? "";

    public static string Normalize(string? value) => Clean(value).ToUpperInvariant();

    public static bool IsValid(string? value)
    {
        var cleaned = Clean(value);
        return cleaned.Length is >= 2 and <= 50 && ValidCharacters().IsMatch(cleaned);
    }

    [GeneratedRegex(@"^[\p{L}\p{N}][\p{L}\p{N}_. -]*$", RegexOptions.CultureInvariant)]
    private static partial Regex ValidCharacters();
}
