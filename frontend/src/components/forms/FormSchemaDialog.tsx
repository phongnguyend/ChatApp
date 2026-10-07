import { useEffect, useRef, useState } from 'react';
import { Braces, Check, Copy, X } from 'lucide-react';
import type { FormDefinition } from './formModel';

export function FormSchemaDialog({ definition, onClose }: { definition: FormDefinition; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const json = JSON.stringify(definition, null, 2);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);

  async function copy() {
    setError('');
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
    } catch {
      setCopied(false);
      setError('Could not access the clipboard. The JSON is selected so you can copy it manually.');
      textRef.current?.focus();
      textRef.current?.select();
    }
  }

  return <dialog ref={dialogRef} className="forms-schema-dialog" aria-labelledby="forms-schema-title" aria-describedby="forms-schema-description" onClose={() => {
    if (!dialogRef.current?.open) {
      onClose();
    }
  }}>
    <header><h2 id="forms-schema-title"><Braces size={20} aria-hidden="true" />JSON schema</h2><button type="button" aria-label="Close JSON schema" onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
    <p id="forms-schema-description">Current form definition, including unsaved changes, nested layouts, and conditional rules.</p>
    <textarea ref={textRef} aria-label="Form JSON schema" value={json} readOnly spellCheck={false} wrap="off" />
    {error && <p className="forms-error" role="alert">{error}</p>}
    <footer><span role="status">{copied ? 'JSON copied to clipboard.' : ''}</span><button type="button" className="forms-primary" onClick={() => { void copy(); }}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}Copy JSON</button></footer>
  </dialog>;
}
