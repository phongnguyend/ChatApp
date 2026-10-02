# Coding conventions

- Always use braces for control-flow bodies, even when the body contains only one statement. This applies to `if`, `else if`, `else`, `for`, `foreach`, `while`, `do`, and similar constructs in languages that support braces.
- Put the body on separate lines rather than writing a single-line control-flow statement. Follow the surrounding language's brace placement style.
- Never compress a braced block onto one line, such as `if (condition) { DoSomething(); return; }`. Put each statement on its own line. In C#, put opening and closing braces on separate lines as well.
- Apply this convention to new and modified code, including tests.
- In C#, separate each property declaration from the next with one blank line, including auto-properties.
- Use database-generated primary keys for new persistence records instead of assigning `Id = Guid.NewGuid()` in application code. For SQL Server GUID keys, configure `HasDefaultValueSql("NEWSEQUENTIALID()").ValueGeneratedOnAdd()` and leave `Id` unset when inserting. Preserve externally supplied identifiers and keys that reference existing records.

Preferred C# formatting:

```csharp
if (context.User.Identity?.IsAuthenticated != true)
{
    context.Response.StatusCode = 401;
    return;
}
```
