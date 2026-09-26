import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

export function AccountHeader({ title, description, eyebrow, actions, onBack }: {
  title: string; description: string; eyebrow: string; actions?: ReactNode; onBack: () => void;
}) {
  return <>
    <header className="account-heading">
      <div className="account-heading-copy"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      <div className="account-heading-actions"><button className="secondary-button" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Back to chat</button>{actions}</div>
    </header>
  </>;
}
