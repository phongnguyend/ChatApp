import { Children, cloneElement, isValidElement, useEffect, useId, useRef, type ComponentPropsWithRef, type HTMLAttributes, type ReactNode } from 'react';
import './Modal.css';

const activeModals = new Set<HTMLDialogElement>();
let previousOverflow = '';

type ModalProps = ComponentPropsWithRef<'dialog'> & {
  layout?: 'panel' | 'backdrop';
  returnFocus?: HTMLElement | null;
};

/** Application modal: focus trapping, inert background, Escape, and focus restoration. */
export function Modal({ children, open = true, layout = 'panel', className = '', returnFocus, ref, onCancel, onKeyDown, ...props }: ModalProps) {
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
  }, [open, titleId, returnFocus]);
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
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    const cancel = buttons.find(button => /^(cancel|close|dismiss|not now|no thanks|decline|deny|keep editing)(\b|$)/i.test(button.getAttribute('aria-label') ?? button.textContent?.trim() ?? ''));
    if (cancel && !cancel.disabled) {
      cancel.click();
    }
  }}>{content}</dialog>;
}

type SectionProps = HTMLAttributes<HTMLElement> & { children?: ReactNode; as?: 'div' | 'header' | 'footer' | 'section' };
function Header({ as: Tag = 'header', className = '', ...props }: SectionProps) {
  return <Tag {...props} className={`app-modal-header ${className}`} />;
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
