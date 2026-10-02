using System.Globalization;
using System.Text;

namespace ChatApp.Infrastructure.DocumentSigning;

/// <summary>
/// Writes a small text-only PDF using the standard Helvetica fonts, which every PDF reader provides,
/// so the audit record needs no PDF library or embedded font files on the server.
/// </summary>
public static class SigningAuditPdf
{
    private const int LinesPerPage = 52;

    private const int WrapColumns = 92;

    public static byte[] Create(string title, IReadOnlyList<(string Label, string Value)> rows)
    {
        var lines = new List<(bool Bold, string Text)>();
        foreach (var (label, value) in rows)
        {
            lines.Add((true, label));
            foreach (var part in Wrap(Ascii(value)))
            {
                lines.Add((false, "    " + part));
            }
        }
        var pages = lines.Chunk(LinesPerPage).ToList();
        if (pages.Count == 0)
        {
            pages.Add([]);
        }

        var objects = new List<string>
        {
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [" + string.Join(" ", pages.Select((_, i) => $"{5 + i * 2} 0 R")) + $"] /Count {pages.Count} >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
        };
        for (var index = 0; index < pages.Count; index++)
        {
            var content = new StringBuilder();
            content.Append("BT\n/F2 16 Tf\n50 790 Td\n(").Append(Escape(Ascii(title))).Append(") Tj\n");
            content.Append("/F1 9 Tf\n0 -18 Td\n(").Append(Escape($"Page {index + 1} of {pages.Count}")).Append(") Tj\n0 -10 Td\n");
            foreach (var (bold, text) in pages[index])
            {
                content.Append(bold ? "/F2 10 Tf\n" : "/F1 10 Tf\n").Append("0 -13.5 Td\n(").Append(Escape(text)).Append(") Tj\n");
            }
            content.Append("ET");
            var stream = content.ToString();
            objects.Add($"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {6 + index * 2} 0 R >>");
            objects.Add($"<< /Length {Encoding.ASCII.GetByteCount(stream)} >>\nstream\n{stream}\nendstream");
        }

        using var output = new MemoryStream();
        void Write(string value)
        {
            var bytes = Encoding.ASCII.GetBytes(value);
            output.Write(bytes);
        }
        Write("%PDF-1.4\n");
        var offsets = new List<long>();
        for (var index = 0; index < objects.Count; index++)
        {
            offsets.Add(output.Position);
            Write($"{index + 1} 0 obj\n{objects[index]}\nendobj\n");
        }
        var xref = output.Position;
        Write($"xref\n0 {objects.Count + 1}\n0000000000 65535 f \n");
        foreach (var offset in offsets)
        {
            Write(offset.ToString("D10", CultureInfo.InvariantCulture) + " 00000 n \n");
        }
        Write($"trailer\n<< /Size {objects.Count + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n");
        return output.ToArray();
    }

    private static IEnumerable<string> Wrap(string value)
    {
        if (value.Length == 0)
        {
            yield return "";
            yield break;
        }
        for (var start = 0; start < value.Length; start += WrapColumns)
        {
            yield return value.Substring(start, Math.Min(WrapColumns, value.Length - start));
        }
    }

    // Helvetica without an embedded font only covers Latin text. Strip diacritics so names such as
    // "Nguyễn Doãn" stay readable, and replace anything else outside printable ASCII.
    public static string Ascii(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var c in value.Replace('đ', 'd').Replace('Đ', 'D').Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }
            builder.Append(c is >= ' ' and <= '~' ? c : '?');
        }
        return builder.ToString();
    }

    private static string Escape(string value) => value.Replace("\\", "\\\\").Replace("(", "\\(").Replace(")", "\\)");
}
