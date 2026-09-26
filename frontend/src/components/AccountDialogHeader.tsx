import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function AccountDialogHeader({ title, description, icon, busy, onClose }: {
  title: string; description: string; icon: ReactNode; busy: boolean; onClose: () => void;
}) {
  return <header className="user-editor-header">
    <span className="user-editor-icon" aria-hidden="true">{icon}</span>
    <div><h2>{title}</h2><p>{description}</p></div>
    <button type="button" className="secondary-button user-editor-close" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button>
  </header>;
}
