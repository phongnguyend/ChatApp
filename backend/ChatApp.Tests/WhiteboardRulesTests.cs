using ChatApp.Application.Whiteboards;
using Xunit;

namespace ChatApp.Tests;

public sealed class WhiteboardRulesTests
{
    [Fact]
    public void ReadsLegacyLayerOrderAndWritesOnlyZ()
    {
        var objects = WhiteboardRules.ReadDocument("""[{"zIndex":7},{"z":2,"zIndex":9},{}]""");
        Assert.Equal(7, objects[0].Z);
        Assert.Equal(2, objects[1].Z);
        Assert.Equal(2, objects[2].Z);
        var json = System.Text.Json.JsonSerializer.Serialize(objects, WhiteboardRules.Json);
        Assert.Contains("\"z\":7", json);
        Assert.DoesNotContain("zIndex", json);
    }

    [Fact]
    public void LayerOrderIsPreservedForLegacyObjectsAndCanBeChangedIndependently()
    {
        var first = Shape() with { Version = 1 };
        var second = Shape() with { Version = 1 };
        var state = WhiteboardRules.Apply([first, second], Change(first with { Z = 2 }, 1), 2);
        Assert.Equal(2, state.Single(x => x.Id == first.Id).Z);
        Assert.Equal(1, state.Single(x => x.Id == second.Id).Z);
        state = WhiteboardRules.Apply(state, Change(Shape(), 0), 3);
        Assert.Equal(3, state.Last().Z);
        Assert.Throws<ArgumentException>(() => WhiteboardRules.Apply(state, Change(first with { Z = double.NaN }, 2), 4));
        Assert.Throws<ArgumentException>(() => WhiteboardRules.Apply(state, Change(first with { Z = 1e13 }, 2), 4));
    }

    private static BoardObject Shape() => new() { Id = Guid.NewGuid() };

    private static BoardCommand Change(BoardObject item, int version) => new(Guid.NewGuid(), [new(version, item)]);

    [Fact]
    public void IndependentObjectsMergeButStaleEditsConflict()
    {
        var first = Shape();
        var second = Shape();
        var state = WhiteboardRules.Apply([], Change(first, 0), 1);
        state = WhiteboardRules.Apply(state, Change(second, 0), 2);
        state = WhiteboardRules.Apply(state, Change(first with { X = 80 }, 1), 3);
        Assert.Equal(2, state.Length);
        Assert.Equal(80, state.Single(x => x.Id == first.Id).X);
        Assert.Equal(2, state.Single(x => x.Id == second.Id).Version);
        Assert.Throws<InvalidOperationException>(() => WhiteboardRules.Apply(state, Change(first, 1), 4));
    }

    [Fact]
    public void DeletionKeepsVersionAndCanBeUndoneWithoutLosingOtherObjects()
    {
        var first = Shape();
        var second = Shape();
        var state = WhiteboardRules.Apply([], new(Guid.NewGuid(), [new(0, first), new(0, second)]), 1);
        state = WhiteboardRules.Apply(state, Change(first with { Deleted = true }, 1), 2);
        Assert.True(state.Single(x => x.Id == first.Id).Deleted);
        Assert.Throws<InvalidOperationException>(() => WhiteboardRules.Apply(state, Change(first, 0), 3));
        state = WhiteboardRules.Apply(state, Change(first, 2), 3);
        Assert.False(state.Single(x => x.Id == first.Id).Deleted);
        Assert.Equal(1, state.Single(x => x.Id == second.Id).Version);
    }

    [Fact]
    public void RejectsMalformedAndUnsafeObjectValues()
    {
        var shape = Shape();
        BoardObject[] invalid = [shape with { X = double.NaN }, shape with { Height = double.PositiveInfinity },
            shape with { Color = "url(https://example.com)" }, shape with { Fill = "<script>" },
            shape with { Kind = "html" }, shape with { Kind = "image" }, shape with { Kind = "path" },
            shape with { Width = -1 }, shape with { Text = new string('a', 4001) },
            shape with { Points = null! }, shape with { Points = [null!] }];
        foreach (var item in invalid)
        {
            Assert.Throws<ArgumentException>(() => WhiteboardRules.Apply([], Change(item, 0), 1));
        }
        Assert.Throws<ArgumentException>(() => WhiteboardRules.Apply([], new(Guid.NewGuid(), [new(0, shape), new(0, shape)]), 1));
        Assert.Throws<ArgumentException>(() => WhiteboardRules.Apply([], new(Guid.NewGuid(), null!), 1));
    }

    [Fact]
    public void EnforcesBoardAndStrokeLimits()
    {
        var state = Enumerable.Range(0, 2000).Select(_ => Shape()).ToArray();
        Assert.Throws<ArgumentException>(() => WhiteboardRules.Apply(state, Change(Shape(), 0), 1));
        Assert.False(WhiteboardRules.Valid(Shape() with { Points = Enumerable.Repeat(new BoardPoint(0, 0), 4001).ToArray() }));
    }
}
