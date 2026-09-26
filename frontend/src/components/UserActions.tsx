import { useId, useRef, type ReactNode } from 'react';
import { Ellipsis } from 'lucide-react';

export function UserActions({ username, children }: { username: string; children: ReactNode }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  return <>
    <button ref={trigger} type="button" className="secondary-button user-actions-trigger" aria-label={`Actions for ${username}`} title="User actions" popoverTarget={id}
      onClick={() => {
        const rect = trigger.current!.getBoundingClientRect();
        const panel = menu.current!;
        panel.style.left = `${Math.max(8, Math.min(rect.right - 208, window.innerWidth - 216))}px`;
        panel.style.top = `${rect.bottom + 190 > window.innerHeight ? Math.max(8, rect.top - 190) : rect.bottom + 6}px`;
      }}><Ellipsis size={19} aria-hidden="true" /></button>
    <div ref={menu} id={id} popover="auto" className="user-actions-menu" aria-label={`Actions for ${username}`}
      onClick={event => { if ((event.target as HTMLElement).closest('button:not(:disabled)')) menu.current?.hidePopover(); }}
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>{children}</div>
  </>;
}
