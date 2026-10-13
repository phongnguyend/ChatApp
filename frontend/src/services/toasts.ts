export type ToastKind = 'success' | 'error' | 'warning' | 'info';
export type ToastOptions = {
  id?: string;
  /** Milliseconds; zero keeps the notification until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void | Promise<void> };
};
export type ToastItem = ToastOptions & {
  id: string;
  kind: ToastKind;
  message: string;
  duration: number;
  revision: number;
};

let sequence = 0;
let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const publish = () => {
  for (const listener of listeners) {
    listener();
  }
};

function show(kind: ToastKind, message: string, options: ToastOptions = {}) {
  if (!message.trim()) {
    return '';
  }
  const existing = options.id ? items.find(item => item.id === options.id)
    : items.find(item => item.kind === kind && item.message === message);
  const id = options.id ?? existing?.id ?? `toast-${++sequence}`;
  const item: ToastItem = {
    ...options, id, kind, message,
    duration: options.duration ?? (kind === 'error' || options.action ? 0 : kind === 'warning' ? 10000 : 6000),
    revision: (existing?.revision ?? 0) + 1,
  };
  items = existing ? items.map(current => current.id === id ? item : current) : [...items, item].slice(-20);
  publish();
  return id;
}

export const toast = {
  success: (message: string, options?: ToastOptions) => show('success', message, options),
  error: (message: string, options?: ToastOptions) => show('error', message, options),
  warning: (message: string, options?: ToastOptions) => show('warning', message, options),
  info: (message: string, options?: ToastOptions) => show('info', message, options),
  dismiss(id: string) {
    items = items.filter(item => item.id !== id);
    publish();
  },
  dismissAll() {
    items = [];
    publish();
  },
};

export const getToasts = () => items;
export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
