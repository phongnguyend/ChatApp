namespace ChatApp.Api.Services;

public static class WebmDurationReader
{
    private const ulong SegmentId = 0x18538067;
    private const ulong InfoId = 0x1549A966;
    private const ulong TimecodeScaleId = 0x2AD7B1;
    private const ulong ClusterId = 0x1F43B675;
    private const ulong ClusterTimecodeId = 0xE7;
    private const ulong SimpleBlockId = 0xA3;
    private const long DefaultTimecodeScaleNanoseconds = 1_000_000;

    public static long? TryReadDurationMilliseconds(string path)
    {
        try
        {
            using var stream = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read);
            var state = new DurationState();
            while (TryReadHeader(stream, out var header))
            {
                var end = ElementEnd(stream, header);
                if (header.Id == SegmentId)
                {
                    ParseSegment(stream, end, state);
                    break;
                }
                SeekToEnd(stream, end);
            }

            return state.DurationMilliseconds();
        }
        catch (Exception exception) when (
            exception is IOException or InvalidDataException or
                EndOfStreamException or OverflowException)
        {
            return null;
        }
    }

    private static void ParseSegment(
        Stream stream,
        long end,
        DurationState state)
    {
        while (stream.Position < end &&
               TryReadHeader(stream, out var header))
        {
            var elementEnd = ElementEnd(stream, header, end);
            switch (header.Id)
            {
                case InfoId:
                    ParseInfo(stream, elementEnd, state);
                    break;
                case ClusterId:
                    ParseCluster(stream, elementEnd, state);
                    break;
                default:
                    SeekToEnd(stream, elementEnd);
                    break;
            }
        }
    }

    private static void ParseInfo(
        Stream stream,
        long end,
        DurationState state)
    {
        while (stream.Position < end &&
               TryReadHeader(stream, out var header))
        {
            var elementEnd = ElementEnd(stream, header, end);
            if (header.Id == TimecodeScaleId &&
                header.Size is > 0 and <= 8)
            {
                state.TimecodeScaleNanoseconds =
                    checked((long)ReadUnsigned(stream, header.Size.Value));
            }
            SeekToEnd(stream, elementEnd);
        }
    }

    private static void ParseCluster(
        Stream stream,
        long end,
        DurationState state)
    {
        long clusterTimecode = 0;
        while (stream.Position < end)
        {
            var headerOffset = stream.Position;
            if (!TryReadHeader(stream, out var header))
            {
                return;
            }
            if (header.Id == ClusterId && end == stream.Length)
            {
                stream.Position = headerOffset;
                return;
            }

            var elementEnd = ElementEnd(stream, header, end);
            if (header.Id == ClusterTimecodeId &&
                header.Size is > 0 and <= 8)
            {
                clusterTimecode =
                    checked((long)ReadUnsigned(stream, header.Size.Value));
            }
            else if (header.Id == SimpleBlockId &&
                     header.Size is >= 4)
            {
                ParseSimpleBlock(
                    stream,
                    header.Size.Value,
                    clusterTimecode,
                    state);
            }
            SeekToEnd(stream, elementEnd);
        }
    }

    private static void ParseSimpleBlock(
        Stream stream,
        long size,
        long clusterTimecode,
        DurationState state)
    {
        var blockStart = stream.Position;
        var track = ReadVariableInteger(stream, removeMarker: true);
        if (track is null || stream.Position + 3 > blockStart + size)
        {
            return;
        }

        var high = stream.ReadByte();
        var low = stream.ReadByte();
        if (high < 0 || low < 0)
        {
            throw new EndOfStreamException();
        }
        var relativeTimecode = unchecked((short)((high << 8) | low));
        state.AddTimestamp(
            track.Value.Value,
            checked(clusterTimecode + relativeTimecode));
    }

    private static bool TryReadHeader(
        Stream stream,
        out ElementHeader header)
    {
        header = default;
        if (stream.Position >= stream.Length)
        {
            return false;
        }

        var id = ReadVariableInteger(stream, removeMarker: false);
        var size = ReadVariableInteger(stream, removeMarker: true);
        if (id is null || size is null)
        {
            return false;
        }
        header = new ElementHeader(
            id.Value.Value,
            size.Value.IsUnknown ? null : checked((long)size.Value.Value));
        return true;
    }

    private static VariableInteger? ReadVariableInteger(
        Stream stream,
        bool removeMarker)
    {
        var first = stream.ReadByte();
        if (first < 0)
        {
            return null;
        }

        var marker = 0x80;
        var length = 1;
        while (length <= 8 && (first & marker) == 0)
        {
            marker >>= 1;
            length++;
        }
        if (length > 8)
        {
            throw new InvalidDataException("Invalid EBML variable integer.");
        }

        ulong value = removeMarker
            ? (uint)(first & (marker - 1))
            : (uint)first;
        for (var index = 1; index < length; index++)
        {
            var next = stream.ReadByte();
            if (next < 0)
            {
                throw new EndOfStreamException();
            }
            value = (value << 8) | (uint)next;
        }

        var unknownValue = removeMarker &&
            value == ((1UL << (length * 7)) - 1);
        return new VariableInteger(value, unknownValue);
    }

    private static ulong ReadUnsigned(Stream stream, long size)
    {
        ulong value = 0;
        for (long index = 0; index < size; index++)
        {
            var next = stream.ReadByte();
            if (next < 0)
            {
                throw new EndOfStreamException();
            }
            value = (value << 8) | (uint)next;
        }
        return value;
    }

    private static long ElementEnd(
        Stream stream,
        ElementHeader header,
        long? parentEnd = null)
    {
        var limit = parentEnd ?? stream.Length;
        if (header.Size is null)
        {
            return limit;
        }
        var end = checked(stream.Position + header.Size.Value);
        if (end > limit || end > stream.Length)
        {
            throw new InvalidDataException("Invalid EBML element size.");
        }
        return end;
    }

    private static void SeekToEnd(Stream stream, long end)
    {
        if (stream.Position < end)
        {
            stream.Position = end;
        }
    }

    private readonly record struct ElementHeader(ulong Id, long? Size);

    private readonly record struct VariableInteger(ulong Value, bool IsUnknown);

    private sealed class DurationState
    {
        private readonly Dictionary<ulong, TrackTimestamps> tracks = [];

        public long TimecodeScaleNanoseconds { get; set; } =
            DefaultTimecodeScaleNanoseconds;

        public void AddTimestamp(ulong track, long timestamp)
        {
            if (timestamp < 0)
            {
                return;
            }
            if (!tracks.TryGetValue(track, out var values))
            {
                tracks[track] = new TrackTimestamps(null, timestamp);
                return;
            }
            if (timestamp > values.Last)
            {
                tracks[track] = new TrackTimestamps(values.Last, timestamp);
            }
        }

        public long? DurationMilliseconds()
        {
            if (tracks.Count == 0 || TimecodeScaleNanoseconds <= 0)
            {
                return null;
            }

            long maximumEnd = 0;
            var maximumEstimatedBlockDuration = Math.Max(
                1,
                1_000_000_000 / TimecodeScaleNanoseconds);
            foreach (var track in tracks.Values)
            {
                var estimatedBlockDuration = track.Previous is not null
                    ? Math.Clamp(
                        track.Last - track.Previous.Value,
                        0,
                        maximumEstimatedBlockDuration)
                    : 0;
                maximumEnd = Math.Max(
                    maximumEnd,
                    checked(track.Last + estimatedBlockDuration));
            }

            var durationNanoseconds = checked(
                maximumEnd * TimecodeScaleNanoseconds);
            return Math.Max(
                1,
                (long)Math.Ceiling(durationNanoseconds / 1_000_000d));
        }
    }

    private readonly record struct TrackTimestamps(long? Previous, long Last);
}
