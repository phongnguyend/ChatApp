using ChatApp.Application.Contracts;
using Ganss.Xss;

namespace ChatApp.Application.Forms;

public static class FormHtmlSanitizer
{
    public static FormDefinition Sanitize(FormDefinition definition)
    {
        var sanitizer = new HtmlSanitizer();
        sanitizer.AllowedTags.Clear();
        sanitizer.AllowedTags.UnionWith(["p", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "strong", "b", "em", "i", "u", "s", "small", "sub", "sup", "ul", "ol", "li", "blockquote", "pre", "code", "a", "img", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption"]);
        sanitizer.AllowedAttributes.Clear();
        sanitizer.AllowedAttributes.UnionWith(["href", "src", "alt", "title", "style", "colspan", "rowspan", "scope"]);
        sanitizer.AllowedCssProperties.Clear();
        sanitizer.AllowedCssProperties.UnionWith(["color", "background-color", "font-size", "font-family", "font-weight", "font-style", "text-align", "text-decoration", "line-height", "white-space", "border", "border-color", "border-width", "border-style", "border-radius", "border-collapse", "padding", "padding-top", "padding-bottom", "padding-left", "padding-right", "margin", "margin-top", "margin-bottom", "margin-left", "margin-right", "width", "max-width", "height"]);
        sanitizer.AllowedSchemes.Clear();
        sanitizer.AllowedSchemes.UnionWith(["https", "http"]);
        sanitizer.AllowedAtRules.Clear();
        sanitizer.FilterUrl += (_, args) =>
        {
            if (!FormRules.IsValidLinkUrl(args.OriginalUrl))
            {
                args.SanitizedUrl = null;
            }
        };
        FormNode[] Clean(FormNode[] nodes) => nodes.Select(node => node with
        {
            Html = node.Kind == "html" ? sanitizer.Sanitize(node.Html) : "",
            Children = Clean(node.Children)
        }).ToArray();
        return definition with { Nodes = Clean(definition.Nodes) };
    }
}
