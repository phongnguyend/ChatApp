using Microsoft.Extensions.Options;

namespace ChatApp.Api.Services;

public sealed class LocalUploadObjectStorage(
    IWebHostEnvironment environment,
    IOptions<UploadStorageOptions> options) : IUploadObjectStorage
{
    private string RootPath
    {
        get
        {
            var configuredPath = options.Value.Path;
            var rootPath = Path.IsPathRooted(configuredPath)
                ? configuredPath
                : Path.Combine(environment.ContentRootPath, configuredPath);

            return Path.GetFullPath(rootPath);
        }
    }

    public async Task WriteAsync(
        string key,
        Stream content,
        CancellationToken cancellationToken)
    {
        var filePath = GetFullPath(key);
        Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);

        var created = false;
        try
        {
            await using var destination = new FileStream(
                filePath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                81920,
                useAsync: true);
            created = true;
            await content.CopyToAsync(destination, cancellationToken);
        }
        catch
        {
            if (created)
            {
                File.Delete(filePath);
            }
            throw;
        }
    }

    public Task<Stream?> OpenReadAsync(
        string key,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var filePath = GetFullPath(key);
        if (!File.Exists(filePath))
        {
            return Task.FromResult<Stream?>(null);
        }

        Stream stream = new FileStream(
            filePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            81920,
            useAsync: true);
        return Task.FromResult<Stream?>(stream);
    }

    public Task DeleteAsync(
        string key,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var filePath = GetFullPath(key);
        if (File.Exists(filePath))
        {
            File.Delete(filePath);
        }

        return Task.CompletedTask;
    }

    private string GetFullPath(string key)
    {
        var normalizedKey = key
            .Replace('\\', Path.DirectorySeparatorChar)
            .Replace('/', Path.DirectorySeparatorChar);
        var fullRoot = RootPath.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var fullPath = Path.GetFullPath(Path.Combine(RootPath, normalizedKey));
        if (!fullPath.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("Invalid upload storage key.");
        }

        return fullPath;
    }
}
