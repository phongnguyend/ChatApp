import { Children, cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type HTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './Modal.css';

const activeModals = new Set<HTMLDialogElement>();
let previousOverflow = '';

function dismissalButton(container: HTMLElement, dialog: HTMLDialogElement, headerOnly = false) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button =>
    !button.hasAttribute('data-modal-close') && button.closest('dialog') === dialog &&
    (headerOnly ? /^(close|dismiss)(\b|$)/i : /^(cancel|close|dismiss|not now|no thanks|decline|deny|keep editing)(\b|$)/i)
      .test(button.getAttribute('aria-label') ?? button.textContent?.trim() ?? ''));
}

type ModalProps = ComponentPropsWithRef<'dialog'> & {
  layout?: 'panel' | 'backdrop';
  returnFocus?: HTMLElement | null;
  initialFocus?: string;
};

/** Application modal: focus trapping, inert background, Escape, and focus restoration. */
export function Modal({ children, open = true, layout = 'panel', className = '', returnFocus, initialFocus, ref, onCancel, onKeyDown, ...props }: ModalProps) {
  const titleId = useId();
  const localRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = localRef.current;
    if (!dialog) {
      return;
    }
    const heading = dialog.querySelector<HTMLElement>('.app-modal-header h2, h2');
    if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby') && heading) {
      heading.id ||= titleId;
      dialog.setAttribute('aria-labelledby', heading.id);
    }
    if (open) {
      if (activeModals.size === 0) {
        previousOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
      }
      activeModals.add(dialog);
    }
    const previous = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (open && !dialog.open) {
      dialog.showModal();
      if (initialFocus) {
        dialog.querySelector<HTMLElement>(initialFocus)?.focus();
      }
    } else if (!open && dialog.open) {
      dialog.close();
    }
    return () => {
      dialog.close();
      if (activeModals.delete(dialog) && activeModals.size === 0) {
        document.documentElement.style.overflow = previousOverflow;
      }
      if (previous?.isConnected) {
        requestAnimationFrame(() => {
          if (previous.isConnected) {
            previous.focus({ preventScroll: true });
          }
        });
      }
    };
  }, [open, titleId, returnFocus, initialFocus]);
  const panel = layout === 'backdrop' ? Children.toArray(children).find(isValidElement<HTMLAttributes<HTMLElement>>) : undefined;
  let hasPanel = false;
  const content = layout === 'backdrop' ? Children.map(children, child => {
    if (!isValidElement<HTMLAttributes<HTMLElement>>(child) || hasPanel) {
      return child;
    }
    hasPanel = true;
    return cloneElement(child, { role: undefined, 'aria-modal': undefined, className: `app-modal-panel ${child.props.className ?? ''}` });
  }) : children;
  return <dialog {...props} role={panel?.props.role === 'alertdialog' ? 'alertdialog' : props.role === 'alertdialog' ? 'alertdialog' : 'dialog'}
    aria-label={props['aria-label'] ?? panel?.props['aria-label']}
    aria-labelledby={props['aria-labelledby'] ?? panel?.props['aria-labelledby']}
    aria-describedby={props['aria-describedby'] ?? panel?.props['aria-describedby']} ref={element => {
    localRef.current = element;
    if (typeof ref === 'function') {
      ref(element);
    } else if (ref) {
      ref.current = element;
    }
  }} className={`app-modal app-modal--${layout} ${className}`} onKeyDown={event => {
    onKeyDown?.(event);
    if (event.key === 'Tab' && !event.defaultPrevented) {
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex], [contenteditable=true]'))
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    event.stopPropagation();
  }} onCancel={event => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (onCancel) {
      onCancel(event);
      return;
    }
    if (props.onClose) {
      return;
    }
    event.preventDefault();
    // Respect each dialog's existing cancellation action and its busy/disabled state.
    const cancel = dismissalButton(event.currentTarget, event.currentTarget);
    if (cancel && !cancel.matches(':disabled')) {
      cancel.click();
    }
  }}>{content}</dialog>;
}

type SectionProps = HTMLAttributes<HTMLElement> & { children?: ReactNode; as?: 'div' | 'header' | 'footer' | 'section' };
function Header({ as: Tag = 'header', className = '', children, ...props }: SectionProps) {
  const headerRef = useRef<HTMLElement>(null);
  const [hasClose, setHasClose] = useState(false);
  const [disabled, setDisabled] = useState(false);
  useLayoutEffect(() => {
    const header = headerRef.current;
    const dialog = header?.closest('dialog');
    if (!header || !dialog) {
      return;
    }
    const update = () => {
      setHasClose(!!dismissalButton(header, dialog, true));
      setDisabled(dismissalButton(dialog, dialog)?.matches(':disabled') ?? false);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(dialog, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-label'] });
    return () => observer.disconnect();
  }, []);
  return <Tag {...props} ref={element => { headerRef.current = element; }} className={`app-modal-header ${className}`}>
    {children}
    {!hasClose && <button type="button" className="app-modal-close" data-modal-close aria-label="Close" title="Close" disabled={disabled} onClick={event => {
      const dialog = event.currentTarget.closest('dialog');
      if (!dialog || dismissalButton(dialog, dialog)?.matches(':disabled')) {
        return;
      }
      // Use exactly the same cancellation path as Escape, including feature guards.
      if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) {
        dialog.close();
      }
    }}><X size={18} aria-hidden="true" /></button>}
  </Tag>;
}
function Body({ as: Tag = 'div', className = '', ...props }: SectionProps) {
  return <Tag {...props} className={`app-modal-body ${className}`} />;
}
function Footer({ as: Tag = 'footer', className = '', ...props }: SectionProps) {
  return <Tag {...props} className={`app-modal-footer ${className}`} />;
}
Modal.Header = Header;
Modal.Body = Body;
Modal.Footer = Footer;
