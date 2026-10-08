using System.Globalization;
using System.Net.Mail;
using ChatApp.Application.Contracts;

namespace ChatApp.Application.Forms;

public static class FormRules
{
    public static bool IsAllowedAttachment(FormNode node, string fileName) =>
        node.AllowedExtensions?.Contains(Path.GetExtension(fileName), StringComparer.OrdinalIgnoreCase) == true;

    public static readonly HashSet<string> QuestionKinds = ["text", "textarea", "email", "url", "number", "date", "time", "datetime", "radio", "checkbox", "select", "rating", "yesno", "attachment"];
    public static bool IsValidLinkUrl(string value) => value.Length <= 2048 &&
        !value.Any(c => char.IsWhiteSpace(c) || char.IsControl(c) || c == '\\') &&
        Uri.TryCreate(value, UriKind.Absolute, out var url) && url.Scheme is "https" or "http" &&
        !string.IsNullOrEmpty(url.Host) && string.IsNullOrEmpty(url.UserInfo);
    private static readonly HashSet<string> Operators = ["equals", "notEquals", "contains", "answered", "notAnswered"];

    public static Dictionary<string, string> ValidateDefinition(FormDefinition definition, bool publishing = false)
    {
        var errors = new Dictionary<string, string>();
        if (string.IsNullOrWhiteSpace(definition.Title) || definition.Title.Length > 200)
        {
            errors["title"] = "A title of 1–200 characters is required.";
        }
        if (definition.Description is null || definition.Description.Length > 4000 || definition.ConfirmationMessage is null || definition.ConfirmationMessage.Length > 2000)
        {
            errors["description"] = "Description or confirmation message is too long or missing.";
        }
        var ids = new HashSet<string>();
        var questions = new HashSet<string>();
        var count = 0;
        var imageBytes = 0;
        void Visit(FormNode[]? nodes, int depth)
        {
            if (nodes is null || depth > 8)
            {
                errors["nodes"] = "Layouts support up to eight nested levels.";
                return;
            }
            foreach (var node in nodes)
            {
                if (++count > 200 || node is null)
                {
                    errors["nodes"] = "A form supports up to 200 blocks.";
                    return;
                }
                var key = node.Id ?? "nodes";
                if (string.IsNullOrWhiteSpace(node.Id) || node.Id.Length > 80 || !ids.Add(node.Id))
                {
                    errors[key] = "Block identifiers must be unique and nonempty.";
                }
                if (!QuestionKinds.Contains(node.Kind) && node.Kind is not ("section" or "columns" or "image" or "link"))
                {
                    errors[key] = "Unknown block type.";
                }
                if (node.Label is null || node.Label.Length > 500 || (QuestionKinds.Contains(node.Kind) && string.IsNullOrWhiteSpace(node.Label)) || node.Description is null || node.Description.Length > 2000)
                {
                    errors[key] = "Provide a question label (up to 500 characters) and a description up to 2000 characters.";
                }
                if (node.ConditionMode is not ("all" or "any") || node.Conditions is null || node.Conditions.Length > 20)
                {
                    errors[key] = "Use all or any with up to 20 conditions.";
                }
                else
                {
                    foreach (var condition in node.Conditions)
                    {
                        if (condition is null || !questions.Contains(condition.QuestionId ?? "") || !Operators.Contains(condition.Operator ?? "") || condition.Value is null || condition.Value.Length > 4000)
                        {
                            errors[key] = "Conditions must reference an earlier question with a valid operator.";
                        }
                    }
                }
                if (node.Kind == "attachment" && (node.AllowedExtensions is null || node.AllowedExtensions.Length is < 1 or > 50 ||
                    node.AllowedExtensions.Any(extension => extension is null || extension.Length is < 2 or > 17 || extension[0] != '.' || !extension[1..].All(char.IsAsciiLetterOrDigit)) ||
                    node.AllowedExtensions.Distinct(StringComparer.OrdinalIgnoreCase).Count() != node.AllowedExtensions.Length))
                {
                    errors[key] = "Provide 1–50 unique extensions starting with a dot, followed by up to 16 letters or numbers (for example .pdf).";
                }
                if (node.Kind == "attachment" && node.MaxFileSizeMb is < 1 or > 20)
                {
                    errors[key] = "Maximum file size must be a whole number between 1 and 20 MB.";
                }
                if (node.Kind == "attachment" && node.MaxFiles is < 1 or > 10)
                {
                    errors[key] = "Attachments allow between 1 and 10 files.";
                }
                if (node.Options is null || node.Options.Length > 100 || node.Options.Any(x => string.IsNullOrWhiteSpace(x) || x.Length > 300) || node.Options.Distinct(StringComparer.Ordinal).Count() != node.Options.Length)
                {
                    errors[key] = "Use up to 100 unique, nonempty choices (300 characters each).";
                }
                else if (node.Kind is "radio" or "checkbox" or "select" && node.Options.Length < 2)
                {
                    errors[key] = "Choice questions need at least two options.";
                }
                if (node.Min > node.Max || (node.Kind == "rating" && (node.Min is not null && node.Min != 1 || node.Max is not null && (node.Max < 2 || node.Max > 10 || node.Max != decimal.Truncate(node.Max.Value)))))
                {
                    errors[key] = "Check the minimum and maximum; ratings use 1 to 2–10.";
                }
                if (node.Kind == "link")
                {
                    if (node.Required || node.Children is null || node.Children.Length != 0 || string.IsNullOrWhiteSpace(node.Label))
                    {
                        errors[key] = "Links need a label and cannot be required or contain child blocks.";
                    }
                    if (string.IsNullOrEmpty(node.LinkUrl))
                    {
                        if (publishing)
                        {
                            errors[key] = "Enter a link URL before publishing.";
                        }
                    }
                    else if (!IsValidLinkUrl(node.LinkUrl))
                    {
                        errors[key] = "Use a complete HTTP or HTTPS URL, without credentials, up to 2048 characters.";
                    }
                }
                else if (node.Kind == "image")
                {
                    if (node.ImageWidth is < 24 or > 2400)
                    {
                        errors[key] = "Image width must be between 24 and 2400 pixels, or empty for automatic sizing.";
                    }
                    if (node.ImageHeight is < 24 or > 1200)
                    {
                        errors[key] = "Image height must be between 24 and 1200 pixels, or empty for automatic sizing.";
                    }
                    if (node.Required || node.Children is null || node.Children.Length != 0 || node.ImageDisplay is not ("logo" or "banner"))
                    {
                        errors[key] = "Images are display-only blocks with logo or banner sizing and no child blocks.";
                    }
                    if (string.IsNullOrEmpty(node.ImageDataUrl))
                    {
                        if (publishing)
                        {
                            errors[key] = "Upload an image or remove the empty image block before publishing.";
                        }
                    }
                    else if (!TryValidateImage(node.ImageDataUrl, out var size))
                    {
                        errors[key] = "Use a base64 PNG, JPEG, or WebP image up to 1 MiB.";
                    }
                    else
                    {
                        imageBytes += size;
                    }
                }
                else if (QuestionKinds.Contains(node.Kind))
                {
                    if (node.Children is null || node.Children.Length != 0)
                    {
                        errors[key] = "Questions cannot contain blocks.";
                    }
                    questions.Add(key);
                }
                else
                {
                    if (node.Kind == "columns" && (node.Children is null || node.Children.Length is < 2 or > 4 || node.Children.Any(x => x is null || x.Kind != "section")))
                    {
                        errors[key] = "A column layout needs two to four section columns.";
                    }
                    Visit(node.Children, depth + 1);
                }
            }
        }
        Visit(definition.Nodes, 1);
        if (imageBytes > 4 * 1024 * 1024)
        {
            errors["images"] = "Embedded images must total no more than 4 MiB per form.";
        }
        if (publishing && questions.Count == 0)
        {
            errors["nodes"] = "Add at least one question before publishing.";
        }
        return errors;
    }

    private static bool TryValidateImage(string dataUrl, out int size)
    {
        size = 0;
        var separator = dataUrl.IndexOf(',');
        if (separator < 0 || separator > 30 || dataUrl.Length - separator - 1 > 1_398_104)
        {
            return false;
        }
        var prefix = dataUrl[..separator];
        if (prefix is not ("data:image/png;base64" or "data:image/jpeg;base64" or "data:image/webp;base64"))
        {
            return false;
        }
        var bytes = new byte[1024 * 1024];
        if (!Convert.TryFromBase64String(dataUrl[(separator + 1)..], bytes, out size) || size == 0)
        {
            return false;
        }
        var data = bytes.AsSpan(0, size);
        return prefix switch
        {
            "data:image/png;base64" => size >= 24 && data[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
            "data:image/jpeg;base64" => size >= 4 && data[0] == 255 && data[1] == 216 && data[2] == 255 && data[^2] == 255 && data[^1] == 217,
            "data:image/webp;base64" => size >= 20 && data[..4].SequenceEqual("RIFF"u8) && data.Slice(8, 4).SequenceEqual("WEBP"u8),
            _ => false
        };
    }

    public static bool IsVisible(FormNode node, IReadOnlyDictionary<string, string[]> visibleAnswers)
    {
        bool Matches(FormCondition condition)
        {
            var values = visibleAnswers.GetValueOrDefault(condition.QuestionId) ?? [];
            var answered = values.Any(x => !string.IsNullOrWhiteSpace(x));
            return condition.Operator switch
            {
                "answered" => answered,
                "notAnswered" => !answered,
                "equals" => answered && values.Contains(condition.Value, StringComparer.Ordinal),
                "notEquals" => answered && !values.Contains(condition.Value, StringComparer.Ordinal),
                "contains" => answered && values.Any(x => x.Contains(condition.Value, StringComparison.Ordinal)),
                _ => false
            };
        }
        return node.Conditions.Length == 0 || (node.ConditionMode == "any" ? node.Conditions.Any(Matches) : node.Conditions.All(Matches));
    }

    public static (Dictionary<string, string[]> Answers, Dictionary<string, string> Errors) ValidateAnswers(FormDefinition definition, Dictionary<string, string[]>? supplied)
    {
        var clean = new Dictionary<string, string[]>();
        var errors = new Dictionary<string, string>();
        if (supplied is null || supplied.Count > 200)
        {
            errors["form"] = "Invalid answer payload.";
            return (clean, errors);
        }
        void Visit(FormNode[] nodes)
        {
            foreach (var node in nodes)
            {
                if (!IsVisible(node, clean))
                {
                    continue;
                }
                if (!QuestionKinds.Contains(node.Kind))
                {
                    Visit(node.Children);
                    continue;
                }
                var values = supplied.GetValueOrDefault(node.Id) ?? [];
                if (values.Length > 100 || values.Any(x => x is null || x.Length > 10000))
                {
                    errors[node.Id] = "Answer is too long.";
                    continue;
                }
                values = node.Kind == "attachment" ? values : values.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.Ordinal).ToArray();
                clean[node.Id] = values;
                if (node.Required && values.Length == 0)
                {
                    errors[node.Id] = "This question is required.";
                }
                if (values.Length == 0)
                {
                    continue;
                }
                if (node.Kind is not ("checkbox" or "attachment") && values.Length != 1)
                {
                    errors[node.Id] = "Provide one answer.";
                    continue;
                }
                var value = values[0];
                var valid = node.Kind switch
                {
                    "url" => IsValidLinkUrl(value),
                    "attachment" => values.Length <= (node.AllowMultipleFiles ? node.MaxFiles : 1) && values.All(name => IsAllowedAttachment(node, name)),
                    "radio" or "select" or "checkbox" => values.All(x => node.Options.Contains(x, StringComparer.Ordinal)),
                    "yesno" => value is "Yes" or "No",
                    "email" => MailAddress.TryCreate(value, out var address) && address.Address == value && value.Length <= 254,
                    "date" => DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _),
                    "time" => value.Length == 5 && TimeOnly.TryParseExact(value, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out _),
                    "datetime" => value.Length == 16 && DateTime.TryParseExact(value, "yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out _),
                    "number" => decimal.TryParse(value, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var number) && (node.Min is null || number >= node.Min) && (node.Max is null || number <= node.Max),
                    "rating" => int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var rating) && rating >= 1 && rating <= (node.Max ?? 5),
                    "text" => value.Length <= 2000,
                    _ => true
                };
                if (!valid)
                {
                    errors[node.Id] = "Enter a valid answer within the allowed choices or range.";
                }
            }
        }
        Visit(definition.Nodes);
        return (clean, errors);
    }
}
