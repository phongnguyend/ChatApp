import { useCallback, useRef } from 'react';
import { toast, type ToastKind } from '../services/toasts';

/** A scoped replacement for transient notification state. Empty messages clear its last toast. */
export function useToastMessage(kind: ToastKind = 'success') {
  const lastId = useRef<string | undefined>(undefined);
  const lastMessage = useRef('');
  return useCallback((value: string | null | ((current: string) => string)) => {
    const message = typeof value === 'function' ? value(lastMessage.current) : value;
    if (typeof value === 'function' && message === lastMessage.current) {
      return;
    }
    lastMessage.current = message ?? '';
    if (!message) {
      if (lastId.current) {
        toast.dismiss(lastId.current);
      }
      lastId.current = undefined;
      return;
    }
    lastId.current = toast[kind](message, { id: lastId.current });
  }, [kind]);
}

