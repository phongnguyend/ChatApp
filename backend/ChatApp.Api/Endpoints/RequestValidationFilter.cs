using System.Collections;
using System.Collections.Concurrent;
using System.ComponentModel.DataAnnotations;
using System.Reflection;
using Microsoft.AspNetCore.Mvc;

namespace ChatApp.Api.Endpoints;

// Preserve ApiController's validation of non-nullable request members after
// moving to Minimal APIs. Endpoint binding still validates routes and query types.
internal static class RequestValidationFilter
{
    private static readonly ConcurrentDictionary<Type, (PropertyInfo Property, bool Required)[]> Properties = new();

    public static EndpointFilterDelegate Create(EndpointFilterFactoryContext factory, EndpointFilterDelegate next)
    {
        var bodyIndexes = factory.MethodInfo.GetParameters()
            .Select((parameter, index) => (parameter, index))
            .Where(item => item.parameter.GetCustomAttribute<FromBodyAttribute>() is not null)
            .Select(item => item.index).ToArray();
        return async context =>
        {
            var errors = new Dictionary<string, string[]>();
            foreach (var index in bodyIndexes)
                Validate(context.Arguments[index], "", errors);
            return errors.Count > 0 ? Results.ValidationProblem(errors) : await next(context);
        };
    }

    private static void Validate(object? value, string path, Dictionary<string, string[]> errors)
    {
        if (value is null || value is string) return;
        if (value is IEnumerable items)
        {
            var index = 0;
            foreach (var item in items) Validate(item, $"{path}[{index++}]", errors);
            return;
        }
        if (value.GetType().Namespace?.StartsWith("ChatApp.", StringComparison.Ordinal) != true) return;

        var results = new List<ValidationResult>();
        Validator.TryValidateObject(value, new ValidationContext(value), results, validateAllProperties: true);
        foreach (var result in results)
            foreach (var member in result.MemberNames.DefaultIfEmpty(""))
                errors[Join(path, member)] = [result.ErrorMessage ?? "Invalid value."];

        var properties = Properties.GetOrAdd(value.GetType(), type =>
        {
            var nullability = new NullabilityInfoContext();
            return type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Where(property => property.CanRead && property.GetIndexParameters().Length == 0)
                .Select(property => (property, !property.PropertyType.IsValueType &&
                    nullability.Create(property).ReadState == NullabilityState.NotNull)).ToArray();
        });
        foreach (var (property, required) in properties)
        {
            var memberValue = property.GetValue(value);
            var memberPath = Join(path, property.Name);
            if (required && memberValue is null)
                errors[memberPath] = [$"The {property.Name} field is required."];
            else
                Validate(memberValue, memberPath, errors);
        }
    }

    private static string Join(string path, string member) => path.Length == 0 ? member : $"{path}.{member}";
}
