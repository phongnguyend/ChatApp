using System.Threading.Channels;

namespace ChatApp.Api.Services;

public sealed class RecordingFinalizationQueue
{
    private readonly Channel<Guid> queue = Channel.CreateBounded<Guid>(
        new BoundedChannelOptions(100)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = false
        });

    public ValueTask EnqueueAsync(
        Guid recordingId,
        CancellationToken cancellationToken) =>
        queue.Writer.WriteAsync(recordingId, cancellationToken);

    public IAsyncEnumerable<Guid> ReadAllAsync(
        CancellationToken cancellationToken) =>
        queue.Reader.ReadAllAsync(cancellationToken);
}
