using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Microsoft.Extensions.Options;

namespace ChatApp.Api.Services;

public sealed class AzureBlobUploadObjectStorage : IUploadObjectStorage
{
    private readonly BlobContainerClient container;
    private readonly string blobPath;
    private readonly string cacheRoot;
    private readonly SemaphoreSlim[] keyLocks =
        Enumerable.Range(0, 256)
            .Select(static _ => new SemaphoreSlim(1, 1))
            .ToArray();

    public AzureBlobUploadObjectStorage(
        IWebHostEnvironment environment,
        IOptions<AzureBlobOptions> options)
    {
        var value = options.Value;
        container = value.CreateBlobContainerClient();
        blobPath = NormalizePrefix(value.Path);
        cacheRoot = ResolveLocalRoot(environment.ContentRootPath, value.LocalCacheFolder);
    }

    public async Task WriteAsync(
        string key,
        Stream content,
        CancellationToken cancellationToken)
    {
        var normalizedKey = NormalizeKey(key);
        var blobClient = container.GetBlobClient(GetBlobName(normalizedKey));
        await blobClient.UploadAsync(
            content,
            overwrite: false,
            cancellationToken);
    }

    public async Task<Stream?> OpenReadAsync(
        string key,
        CancellationToken cancellationToken)
    {
        if (TryGetDirectBlobClient(key, out var directBlob))
        {
            try
            {
                var response = await directBlob.DownloadStreamingAsync(
                    cancellationToken: cancellationToken);
                return response.Value.Content;
            }
            catch (RequestFailedException exception) when (exception.Status == 404)
            {
                return null;
            }
        }

        var normalizedKey = NormalizeKey(key);
        var cachePath = GetCachePath(normalizedKey);
        var cachedStream = TryOpenCache(cachePath);
        if (cachedStream is not null)
        {
            return cachedStream;
        }

        var keyLock = GetKeyLock(normalizedKey);
        await keyLock.WaitAsync(cancellationToken);
        try
        {
            cachedStream = TryOpenCache(cachePath);
            if (cachedStream is not null)
            {
                return cachedStream;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(cachePath)!);
            var downloadPath = $"{cachePath}.{Guid.NewGuid():N}.download";
            try
            {
                var blobClient = container.GetBlobClient(GetBlobName(normalizedKey));
                await blobClient.DownloadToAsync(downloadPath, cancellationToken);
                PublishCacheFile(downloadPath, cachePath);
            }
            catch (RequestFailedException exception) when (exception.Status == 404)
            {
                return null;
            }
            finally
            {
                File.Delete(downloadPath);
            }

            return TryOpenCache(cachePath);
        }
        finally
        {
            keyLock.Release();
        }
    }

    public async Task DeleteAsync(
        string key,
        CancellationToken cancellationToken)
    {
        if (TryGetDirectBlobClient(key, out var directBlob))
        {
            await directBlob.DeleteIfExistsAsync(
                DeleteSnapshotsOption.IncludeSnapshots,
                cancellationToken: cancellationToken);
            return;
        }

        var normalizedKey = NormalizeKey(key);
        var keyLock = GetKeyLock(normalizedKey);
        await keyLock.WaitAsync(cancellationToken);
        try
        {
            File.Delete(GetCachePath(normalizedKey));
            await container.DeleteBlobIfExistsAsync(
                GetBlobName(normalizedKey),
                DeleteSnapshotsOption.IncludeSnapshots,
                cancellationToken: cancellationToken);
        }
        finally
        {
            keyLock.Release();
        }
    }

    private SemaphoreSlim GetKeyLock(string key) =>
        keyLocks[(StringComparer.Ordinal.GetHashCode(key) & int.MaxValue) %
            keyLocks.Length];

    private static FileStream? TryOpenCache(string cachePath)
    {
        try
        {
            return new FileStream(
                cachePath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read | FileShare.Delete,
                81920,
                useAsync: true);
        }
        catch (FileNotFoundException)
        {
            return null;
        }
        catch (DirectoryNotFoundException)
        {
            return null;
        }
    }

    private static void PublishCacheFile(string sourcePath, string cachePath)
    {
        try
        {
            File.Move(sourcePath, cachePath, overwrite: false);
        }
        catch (IOException) when (File.Exists(cachePath))
        {
            // Another application instance populated the shared cache first.
        }
    }

    private string GetBlobName(string normalizedKey) =>
        string.IsNullOrEmpty(blobPath)
            ? normalizedKey
            : $"{blobPath}/{normalizedKey}";

    private bool TryGetDirectBlobClient(
        string key,
        out BlobClient blobClient)
    {
        blobClient = null!;
        if (!Uri.TryCreate(key, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps ||
            !string.Equals(
                uri.Scheme,
                container.Uri.Scheme,
                StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(
                uri.Authority,
                container.Uri.Authority,
                StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var containerPath = container.Uri.AbsolutePath.TrimEnd('/');
        if (!uri.AbsolutePath.StartsWith(
                $"{containerPath}/",
                StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var blobName = Uri.UnescapeDataString(
            uri.AbsolutePath[(containerPath.Length + 1)..]);
        if (string.IsNullOrWhiteSpace(blobName)) return false;
        blobClient = container.GetBlobClient(blobName);
        return true;
    }

    private string GetCachePath(string normalizedKey)
    {
        var normalizedLocalKey = normalizedKey.Replace(
            '/',
            Path.DirectorySeparatorChar);
        var fullRoot = cacheRoot.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var fullPath = Path.GetFullPath(
            Path.Combine(cacheRoot, normalizedLocalKey));
        if (!fullPath.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("Invalid upload storage key.");
        }

        return fullPath;
    }

    private static string NormalizeKey(string key)
    {
        var normalized = key.Replace('\\', '/').Trim('/');
        var segments = normalized.Split(
            '/',
            StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0 ||
            segments.Any(segment =>
                segment is "." or ".." ||
                segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0))
        {
            throw new InvalidDataException("Invalid upload storage key.");
        }

        return string.Join('/', segments);
    }

    private static string NormalizePrefix(string prefix)
    {
        if (string.IsNullOrWhiteSpace(prefix))
        {
            return "";
        }

        return NormalizeKey(prefix);
    }

    private static string ResolveLocalRoot(
        string contentRootPath,
        string configuredPath)
    {
        var path = Path.IsPathRooted(configuredPath)
            ? configuredPath
            : Path.Combine(contentRootPath, configuredPath);
        return Path.GetFullPath(path);
    }
}
