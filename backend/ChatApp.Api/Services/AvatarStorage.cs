namespace ChatApp.Api.Services;

public sealed class AvatarStorage(IUploadObjectStorage storage) : IAvatarStorage
{
    public const long MaxFileSize = 5 * 1024 * 1024;

    private static readonly IReadOnlyDictionary<string, string> Extensions =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["image/jpeg"] = ".jpg",
            ["image/png"] = ".png",
            ["image/webp"] = ".webp",
            ["image/gif"] = ".gif"
        };

    public async Task<string> SaveAsync(
        IFormFile image,
        CancellationToken cancellationToken)
    {
        if (image.Length is <= 0 or > MaxFileSize)
        {
            throw new InvalidDataException("Choose an image smaller than 5 MB.");
        }

        if (!Extensions.TryGetValue(image.ContentType, out var extension))
        {
            throw new InvalidDataException("Use a JPEG, PNG, WebP, or GIF image.");
        }

        await using (var input = image.OpenReadStream())
        {
            var header = new byte[12];
            var read = await input.ReadAsync(header, cancellationToken);
            if (!HasValidSignature(image.ContentType, header.AsSpan(0, read)))
            {
                throw new InvalidDataException("The selected file is not a valid image.");
            }
        }

        var fileName = $"{Guid.NewGuid():N}{extension}";
        await using var source = image.OpenReadStream();
        await storage.WriteAsync(
            $"avatars/{fileName}",
            source,
            cancellationToken);

        return $"/uploads/avatars/{fileName}";
    }

    public Task<Stream?> OpenReadAsync(
        string fileName,
        CancellationToken cancellationToken)
    {
        ValidateFileName(fileName);
        return storage.OpenReadAsync($"avatars/{fileName}", cancellationToken);
    }

    private static void ValidateFileName(string fileName)
    {
        var extension = Path.GetExtension(fileName);
        var name = Path.GetFileNameWithoutExtension(fileName);
        if (fileName == Path.GetFileName(fileName) &&
            Guid.TryParseExact(name, "N", out _) &&
            Extensions.Values.Contains(
                extension,
                StringComparer.OrdinalIgnoreCase))
        {
            return;
        }

        throw new InvalidDataException("Invalid avatar file name.");
    }

    private static bool HasValidSignature(string contentType, ReadOnlySpan<byte> header) =>
        contentType.ToLowerInvariant() switch
        {
            "image/jpeg" => header.Length >= 3 &&
                header[0] == 0xff && header[1] == 0xd8 && header[2] == 0xff,
            "image/png" => header.Length >= 8 &&
                header[..8].SequenceEqual(
                    new byte[] { 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a }),
            "image/gif" => header.Length >= 6 &&
                (header[..6].SequenceEqual("GIF87a"u8) ||
                 header[..6].SequenceEqual("GIF89a"u8)),
            "image/webp" => header.Length >= 12 &&
                header[..4].SequenceEqual("RIFF"u8) &&
                header[8..12].SequenceEqual("WEBP"u8),
            _ => false
        };
}
