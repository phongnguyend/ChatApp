export type DialogRequest = { id: number; kind: 'confirm' | 'prompt' | 'alert'; message: string; initial: string; opener: HTMLElement | null; resolve: (value: string | boolean | null) => void };
let queue: DialogRequest[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
function publish() {
  for (const listener of listeners) {
    listener();
  }
}
function request(kind: DialogRequest['kind'], message: string, initial = '') {
  return new Promise<string | boolean | null>(resolve => {
    queue = [...queue, { id: ++nextId, kind, message, initial, opener: document.activeElement instanceof HTMLElement ? document.activeElement : null, resolve }];
    publish();
  });
}
export async function confirmDialog(message: string): Promise<boolean> {
  return await request('confirm', message) === true;
}
export async function promptDialog(message: string, initial = ''): Promise<string | null> {
  const result = await request('prompt', message, initial);
  return typeof result === 'string' ? result : null;
}
export async function alertDialog(message: string): Promise<void> {
  await request('alert', message);
}
export function finishDialog(item: DialogRequest, value: string | boolean | null) {
  if (queue[0] !== item) {
    return;
  }
  queue = queue.slice(1);
  item.resolve(value);
  publish();
}

export function subscribeDialogs(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function currentDialog() {
  return queue[0];
}
