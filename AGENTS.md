# Coding conventions

- Always use braces for control-flow bodies, even when the body contains only one statement. This applies to `if`, `else if`, `else`, `for`, `foreach`, `while`, `do`, and similar constructs in languages that support braces.
- Put the body on separate lines rather than writing a single-line control-flow statement. Follow the surrounding language's brace placement style.
- Never compress a braced block onto one line, such as `if (condition) { DoSomething(); return; }`. Put each statement on its own line. In C#, put opening and closing braces on separate lines as well.
- Apply this convention to new and modified code, including tests.
- In C#, separate each property declaration from the next with one blank line, including auto-properties.
- In C#, separate each endpoint mapping (`MapGet`, `MapPost`, `MapPut`, `MapDelete`, `MapGroup`, and similar) from the next statement with one blank line, including mappings whose handler fits on one or two lines.
- Use database-generated primary keys for new persistence records instead of assigning `Id = Guid.NewGuid()` in application code. For SQL Server GUID keys, configure `HasDefaultValueSql("NEWSEQUENTIALID()").ValueGeneratedOnAdd()` and leave `Id` unset when inserting. Preserve externally supplied identifiers and keys that reference existing records.

## Frontend modal dialogs

- Use `frontend/src/components/Modal.tsx` for every modal dialog, with `Modal.Header`, `Modal.Body`, and `Modal.Footer` for the title/close controls, content, and actions. Omit an empty footer only when there are no actions.
- Use the shared visual styling from `Modal.css`. Merely wrapping an old popup in `Modal` is not a completed migration: remove its old shell, padding, backdrop, header, and footer styles so the shared sections actually control its appearance. Feature CSS may size specialized content such as document viewers, but must not recreate a competing modal design.
- Every modal header must show an accessible close control at the top right. `Modal.Header` supplies one when an existing Close/Dismiss button is absent. Closing must follow cancellation behavior, preserve busy-state guards, and never confirm a destructive action; verify there is exactly one header close control.
- Never use browser `alert`, `confirm`, or `prompt`, including unqualified calls and `window` aliases. Use the asynchronous helpers in `frontend/src/services/dialogs.ts` (rendered by `AppDialogs.tsx`) for simple messages, confirmations, and text input; use the shared Modal for richer forms. Do not add browser `beforeunload` confirmation popups.
- Only the shared Modal implementation may render raw `<dialog>` elements or own modal focus trapping, Escape handling, backdrop behavior, and focus restoration. Do not create separate modal implementations or duplicate lifecycle code in features. Nonmodal popovers (such as emoji or date pickers) are not modals.
- Preserve cancellation, busy-state guards, keyboard operation, accessible names, and nested-dialog behavior. Await confirmation before performing an action, and treat Escape or Cancel as cancellation.
- Run `npm run test:modals` in `frontend` after modal changes.
- Before completing a modal migration, audit the entire requested scope for browser popup calls, raw dialogs, legacy modal shells/styles, and missing shared sections. Verify the actual rendered Header/Body/Footer layout, not just component imports. Test confirmation and cancellation, Escape, focus trapping/restoration, and representative existing dialogs; do not claim consistency while legacy-looking popups remain.

## Frontend notifications

- Use `frontend/src/services/toasts.ts` (`toast.success`, `toast.error`, `toast.warning`, `toast.info`) for transient action feedback everywhere. `components/useToastMessage.ts` is the scoped alternative for existing notification setters; clear it with an empty message. Do not create feature-specific success banners, toast hosts, or notification timers.
- Mount `ToastViewport` exactly once in `main.tsx`. It handles stacking, accessible announcements, dismissal, timing, and placement above native modals. Do not put notifications in browser alerts or acknowledgement modals.
- Keep field validation, loading/connection status, empty states, public form completion screens, and persistent recovery controls inline. Do not replace actionable validation with a disappearing toast or announce the same error both inline and as a toast.
- Errors remain until dismissed by default; routine success/info messages expire after six seconds. Use an explicit duration or action only when the workflow needs it. Reuse an ID to update an existing notification; never include secrets in notification text.
- After notification changes, run `npm run test:toasts` and verify representative flows, modal visibility, keyboard dismissal, duplicate suppression, and timers paused during hover/focus. Ensure icons do not shrink and check small screens and both themes.

Preferred C# formatting:

```csharp
if (context.User.Identity?.IsAuthenticated != true)
{
    context.Response.StatusCode = 401;
    return;
}
```
