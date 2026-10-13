import { useToastMessage } from './useToastMessage';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { getToasts, subscribeToasts, toast, type ToastItem, type ToastKind } from '../services/toasts';
import './Toast.css';

const icons = { success: CheckCircle2, error: CircleAlert, warning: TriangleAlert, info: Info };

/** Bridge for state also used by a workspace's error/recovery logic. */
export function ToastNotice({ message, kind = 'error' }: { message: string | null; kind?: ToastKind }) {
  const notify = useToastMessage(kind);
  useEffect(() => {
    notify(message);
  }, [message, notify]);
  return null;
}

function Toast({ item }: { item: ToastItem }) {
  const Icon = icons[item.kind];
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const remaining = useRef(item.duration);
  useEffect(() => {
    const changed = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => {
    remaining.current = item.duration;
  }, [item.duration, item.revision]);
  useEffect(() => {
    if (!item.duration || hovered || focused || hidden || busy) {
      return;
    }
    const started = performance.now();
    const timer = window.setTimeout(() => toast.dismiss(item.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [item.id, item.duration, item.revision, hovered, focused, hidden, busy]);
  return <div className={`app-toast app-toast--${item.kind}`} data-toast-id={item.id}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        setFocused(false);
      }
    }}>
    <Icon className="app-toast-icon" size={21} aria-hidden="true" />
    <div className="app-toast-content">
      <p role={item.kind === 'error' ? 'alert' : 'status'} aria-atomic="true">{item.message}</p>
      {item.action && <button type="button" className="app-toast-action" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          await item.action?.onClick();
          toast.dismiss(item.id);
        } catch (reason) {
          toast.error(reason instanceof Error ? reason.message : 'The action failed. Please try again.');
        } finally {
          setBusy(false);
        }
      }}>{busy ? 'Working…' : item.action.label}</button>}
    </div>
    <button type="button" className="app-toast-dismiss" aria-label="Dismiss notification" title="Dismiss notification" disabled={busy} onClick={() => toast.dismiss(item.id)}><X size={18} aria-hidden="true" /></button>
  </div>;
}

/** One application host, portalled into the top open modal so native inertness never hides it. */
export function ToastViewport() {
  const items = useSyncExternalStore(subscribeToasts, getToasts);
  const [container, setContainer] = useState<HTMLElement>(document.body);
  useEffect(() => {
    let opened: HTMLDialogElement[] = [];
    const clear = () => toast.dismissAll();
    window.addEventListener('chatapp-auth-expired', clear);
    const update = () => {
      const current = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog.app-modal[open]'));
      opened = [...opened.filter(dialog => current.includes(dialog)), ...current.filter(dialog => !opened.includes(dialog))];
      setContainer(opened.at(-1) ?? document.body);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    return () => {
      observer.disconnect();
      window.removeEventListener('chatapp-auth-expired', clear);
    };
  }, []);
  if (!items.length) {
    return null;
  }
  return createPortal(<section className="app-toast-viewport" aria-label="Notifications" onKeyDown={event => {
    if (event.key !== 'Tab' && event.key !== 'Escape') {
      event.stopPropagation();
    }
  }}>
    {items.slice(0, 4).map(item => <Toast key={item.id} item={item} />)}
    {items.length > 1 && <button type="button" className="app-toast-clear" onClick={() => toast.dismissAll()}>Dismiss all{items.length > 4 ? ` (${items.length})` : ''}</button>}
  </section>, container);
}
