using Microsoft.Extensions.Options;

namespace ChatApp.Api.Services;

public sealed class MessageAttachmentStorage(
    IWebHostEnvironment environment,
    IOptions<UploadStorageOptions> options)
{
    public const int MaxFilesPerMessage = 5;
    public const long MaxFileSize = 15 * 1024 * 1024;

    private static readonly HashSet<string> ImageContentTypes =
    [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif"
    ];

    private static readonly HashSet<string> VideoContentTypes =
    [
        "video/webm",
        "video/mp4"
    ];

    private string RootPath
    {
        get
        {
            var configuredPath = options.Value.Path;
            var rootPath = Path.IsPathRooted(configuredPath)
                ? configuredPath
                : Path.Combine(environment.ContentRootPath, configuredPath);

            return Path.Combine(Path.GetFullPath(rootPath), "attachments");
        }
    }

    public bool IsDisplayableImage(string contentType) =>
        ImageContentTypes.Contains(NormalizeContentType(contentType));

    public bool IsDisplayableVideo(string contentType) =>
        VideoContentTypes.Contains(NormalizeContentType(contentType));

    public async Task<string> SaveAsync(
        Guid conversationId,
        Guid messageId,
        IFormFile file,
        CancellationToken cancellationToken)
    {
        Validate(file);

        var extension = Path.GetExtension(Path.GetFileName(file.FileName));
        if (extension.Length > 12 ||
            extension.Any(character => !char.IsLetterOrDigit(character) && character != '.'))
        {
            extension = "";
        }

        var relativeDirectory = Path.Combine(
            conversationId.ToString("N"),
            messageId.ToString("N"));
        var uploadDirectory = Path.Combine(RootPath, relativeDirectory);
        Directory.CreateDirectory(uploadDirectory);

        var storedFileName = $"{Guid.NewGuid():N}{extension.ToLowerInvariant()}";
        var storageKey = Path.Combine(relativeDirectory, storedFileName)
            .Replace(Path.DirectorySeparatorChar, '/');
        var filePath = GetFullPath(storageKey);

        await using var source = file.OpenReadStream();
        await using var destination = new FileStream(
            filePath,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            81920,
            useAsync: true);
        await source.CopyToAsync(destination, cancellationToken);

        return storageKey;
    }

    public FileStream OpenRead(string storageKey) =>
        new(
            GetFullPath(storageKey),
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            81920,
            useAsync: true);

    public void Delete(string storageKey)
    {
        var filePath = GetFullPath(storageKey);
        if (File.Exists(filePath))
        {
            File.Delete(filePath);
        }
    }

    public string CleanFileName(string fileName)
    {
        var cleaned = new string(
            Path.GetFileName(fileName)
                .Where(character => !char.IsControl(character))
                .ToArray())
            .Trim();
        if (string.IsNullOrWhiteSpace(cleaned))
        {
            return "attachment";
        }

        return cleaned.Length <= 255 ? cleaned : cleaned[..255];
    }

    private void Validate(IFormFile file)
    {
        if (file.Length is <= 0 or > MaxFileSize)
        {
            throw new InvalidDataException("Each attachment must be smaller than 15 MB.");
        }

        if (IsDisplayableImage(file.ContentType))
        {
            using var input = file.OpenReadStream();
            Span<byte> header = stackalloc byte[12];
            var read = input.Read(header);
            if (!HasValidImageSignature(file.ContentType, header[..read]))
            {
                throw new InvalidDataException(
                    $"\"{CleanFileName(file.FileName)}\" is not a valid image.");
            }
        }
        else if (IsDisplayableVideo(file.ContentType))
        {
            using var input = file.OpenReadStream();
            Span<byte> header = stackalloc byte[12];
            var read = input.Read(header);
            if (!HasValidVideoSignature(file.ContentType, header[..read]))
            {
                throw new InvalidDataException(
                    $"\"{CleanFileName(file.FileName)}\" is not a valid video.");
            }
        }
    }

    private string GetFullPath(string storageKey)
    {
        var normalizedKey = storageKey.Replace('/', Path.DirectorySeparatorChar);
        var fullRoot = Path.GetFullPath(RootPath) + Path.DirectorySeparatorChar;
        var fullPath = Path.GetFullPath(Path.Combine(RootPath, normalizedKey));
        if (!fullPath.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("Invalid attachment storage key.");
        }

        return fullPath;
    }

    private static bool HasValidImageSignature(
        string contentType,
        ReadOnlySpan<byte> header) =>
        NormalizeContentType(contentType) switch
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

    private static bool HasValidVideoSignature(
        string contentType,
        ReadOnlySpan<byte> header) =>
        NormalizeContentType(contentType) switch
        {
            "video/webm" => header.Length >= 4 &&
                header[..4].SequenceEqual(new byte[] { 0x1a, 0x45, 0xdf, 0xa3 }),
            "video/mp4" => header.Length >= 8 &&
                header[4..8].SequenceEqual("ftyp"u8),
            _ => false
        };

    private static string NormalizeContentType(string contentType) =>
        contentType.Split(';', 2)[0].Trim().ToLowerInvariant();
}
