namespace ChatApp.Api.Services;

public sealed class MessageAttachmentStorage(
    IUploadObjectStorage storage) : IMessageAttachmentStorage
{
    private const int MaximumFilesPerMessage = 5;
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

    private static readonly HashSet<string> AudioContentTypes =
    [
        "audio/webm",
        "audio/ogg",
        "audio/mp4",
        "audio/mpeg",
        "audio/wav"
    ];

    public int MaxFilesPerMessage => MaximumFilesPerMessage;

    public bool IsDisplayableImage(string contentType) =>
        ImageContentTypes.Contains(NormalizeContentType(contentType));

    public bool IsDisplayableVideo(string contentType) =>
        VideoContentTypes.Contains(NormalizeContentType(contentType));

    public bool IsDisplayableAudio(string contentType) =>
        AudioContentTypes.Contains(NormalizeContentType(contentType));

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

        var relativeDirectory =
            $"{conversationId:N}/{messageId:N}";
        var storedFileName = $"{Guid.NewGuid():N}{extension.ToLowerInvariant()}";
        var storageKey = $"{relativeDirectory}/{storedFileName}";

        await using var source = file.OpenReadStream();
        await storage.WriteAsync(
            GetObjectKey(storageKey),
            source,
            cancellationToken);

        return storageKey;
    }

    public Task<Stream?> OpenReadAsync(
        string storageKey,
        CancellationToken cancellationToken) =>
        storage.OpenReadAsync(GetObjectKey(storageKey), cancellationToken);

    public Task DeleteAsync(
        string storageKey,
        CancellationToken cancellationToken) =>
        storage.DeleteAsync(GetObjectKey(storageKey), cancellationToken);

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
        else if (IsDisplayableAudio(file.ContentType))
        {
            using var input = file.OpenReadStream();
            Span<byte> header = stackalloc byte[12];
            var read = input.Read(header);
            if (!HasValidAudioSignature(file.ContentType, header[..read]))
            {
                throw new InvalidDataException(
                    $"\"{CleanFileName(file.FileName)}\" is not a valid audio recording.");
            }
        }
    }

    private static string GetObjectKey(string storageKey)
    {
        if (string.IsNullOrWhiteSpace(storageKey))
        {
            throw new InvalidDataException("Invalid attachment storage key.");
        }

        return $"attachments/{storageKey}";
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

    private static bool HasValidAudioSignature(
        string contentType,
        ReadOnlySpan<byte> header) =>
        NormalizeContentType(contentType) switch
        {
            "audio/webm" => header.Length >= 4 &&
                header[..4].SequenceEqual(new byte[] { 0x1a, 0x45, 0xdf, 0xa3 }),
            "audio/ogg" => header.Length >= 4 &&
                header[..4].SequenceEqual("OggS"u8),
            "audio/mp4" => header.Length >= 8 &&
                header[4..8].SequenceEqual("ftyp"u8),
            "audio/mpeg" => header.Length >= 3 &&
                (header[..3].SequenceEqual("ID3"u8) ||
                 (header[0] == 0xff && (header[1] & 0xe0) == 0xe0)),
            "audio/wav" => header.Length >= 12 &&
                header[..4].SequenceEqual("RIFF"u8) &&
                header[8..12].SequenceEqual("WAVE"u8),
            _ => false
        };

    private static string NormalizeContentType(string contentType) =>
        contentType.Split(';', 2)[0].Trim().ToLowerInvariant();
}
