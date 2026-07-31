using Microsoft.Extensions.Options;

namespace ChatApp.Api.Services;

public sealed class RecordingChunkTempStorage(
    IWebHostEnvironment environment,
    IOptions<UploadStorageOptions> options)
{
    private const string ReferencePrefix = "temp:";

    private string RootPath
    {
        get
        {
            var configuredPath = options.Value.RecordingTempPath;
            if (string.IsNullOrWhiteSpace(configuredPath))
            {
                return Path.Combine(
                    Path.GetTempPath(),
                    "chatapp-recording-chunks");
            }
            return Path.GetFullPath(
                Path.IsPathRooted(configuredPath)
                    ? configuredPath
                    : Path.Combine(
                        environment.ContentRootPath,
                        configuredPath));
        }
    }

    public static bool IsTemporaryReference(string reference) =>
        reference.StartsWith(
            ReferencePrefix,
            StringComparison.Ordinal);

    public async Task<string> WriteAsync(
        Guid recordingId,
        int sequence,
        Stream content,
        CancellationToken cancellationToken)
    {
        var finalPath = GetChunkPath(recordingId, sequence);
        Directory.CreateDirectory(Path.GetDirectoryName(finalPath)!);
        var uploadPath = $"{finalPath}.{Guid.NewGuid():N}.upload";
        try
        {
            await using (var destination = new FileStream(
                uploadPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                81920,
                useAsync: true))
            {
                await content.CopyToAsync(destination, cancellationToken);
            }

            try
            {
                File.Move(uploadPath, finalPath, overwrite: false);
            }
            catch (IOException) when (File.Exists(finalPath))
            {
                // A retry or concurrent request already published this chunk.
            }
            return GetReference(recordingId, sequence);
        }
        finally
        {
            File.Delete(uploadPath);
        }
    }

    public Task<Stream?> OpenReadAsync(
        Guid recordingId,
        int sequence,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var path = GetChunkPath(recordingId, sequence);
        if (!File.Exists(path))
        {
            return Task.FromResult<Stream?>(null);
        }
        Stream stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read | FileShare.Delete,
            81920,
            useAsync: true);
        return Task.FromResult<Stream?>(stream);
    }

    public Task DeleteAsync(
        Guid recordingId,
        int sequence,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var path = GetChunkPath(recordingId, sequence);
        File.Delete(path);
        DeleteEmptyRecordingDirectory(recordingId);
        return Task.CompletedTask;
    }

    private string GetChunkPath(Guid recordingId, int sequence)
    {
        if (recordingId == Guid.Empty || sequence is < 0 or > 1_000_000)
        {
            throw new InvalidDataException(
                "Invalid temporary recording chunk path.");
        }
        var root = Path.GetFullPath(RootPath);
        var fullRoot = root.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var path = Path.GetFullPath(
            Path.Combine(
                root,
                recordingId.ToString("N"),
                $"{sequence:D8}.webm"));
        if (!path.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException(
                "Invalid temporary recording chunk path.");
        }
        return path;
    }

    private static string GetReference(Guid recordingId, int sequence) =>
        $"{ReferencePrefix}{recordingId:N}/{sequence:D8}.webm";

    private void DeleteEmptyRecordingDirectory(Guid recordingId)
    {
        var directory = Path.GetDirectoryName(GetChunkPath(recordingId, 0))!;
        try
        {
            if (Directory.Exists(directory) &&
                !Directory.EnumerateFileSystemEntries(directory).Any())
            {
                Directory.Delete(directory);
            }
        }
        catch (IOException)
        {
            // Another chunk operation is still using this directory.
        }
    }
}
