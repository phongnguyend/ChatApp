using ChatApp.Application.Contracts;

namespace ChatApp.Application.Forms;

public static class FormPages
{
    // Legacy stored definitions used root-level page markers. Convert them on read.
    public static FormDefinition Normalize(FormDefinition definition)
    {
        if (definition.Nodes is null || definition.Pages is not null && !definition.Nodes.Any(node => node?.Kind == "page"))
        {
            return definition;
        }
        var pages = definition.Pages?.ToList() ?? new List<FormPage>();
        var nodes = new List<FormNode>();
        var current = pages.FirstOrDefault() ?? new FormPage("__first_page", "", "");
        string? legacyGroup = null;
        if (pages.Count == 0 && definition.Nodes.FirstOrDefault()?.Kind != "page")
        {
            pages.Add(current);
        }
        foreach (var node in definition.Nodes)
        {
            if (node is not null && node.Kind == "page" && node.Children?.Length == 0 && node.Conditions?.Length == 0 && !node.Required)
            {
                legacyGroup = node.PageId;
                current = pages.FirstOrDefault(page => page?.Id == node.Id) ?? new FormPage(node.Id, node.Label, node.Description);
                if (!pages.Contains(current))
                {
                    pages.Add(current);
                }
            }
            else
            {
                var pageId = definition.Pages is null || node?.PageId is null || node.PageId == legacyGroup ? current.Id : node.PageId;
                nodes.Add(Assign(node!, pageId));
            }
        }
        if (pages.Count == 0)
        {
            pages.Add(current);
        }
        return definition with { Pages = pages.ToArray(), Nodes = nodes.ToArray() };
    }

    private static FormNode Assign(FormNode node, string pageId)
    {
        if (node is null)
        {
            return null!;
        }
        return node with { PageId = pageId, Children = node.Children?.Select(child => Assign(child, pageId)).ToArray()! };
    }

    public static FormNode[] OrderedNodes(FormDefinition definition)
    {
        return definition.Pages is null ? definition.Nodes : definition.Pages
            .SelectMany(page => definition.Nodes.Where(node => node is null || node.PageId == page.Id)).ToArray();
    }
}
