import { Modal } from '../Modal';
import { useToastMessage } from '../useToastMessage';
import { toast } from '../../services/toasts';
import { useRef, useState } from 'react';
import { Braces, Check, Copy, X } from 'lucide-react';
import type { FormDefinition } from './formModel';
import { JsonViewer } from '../JsonViewer';
import { selectJsonText } from '../jsonViewerSelection';

export function FormSchemaDialog({ definition, onClose }: { definition: FormDefinition; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const setError = useToastMessage('error');
  const json = JSON.stringify(definition, null, 2);



  async function copy() {
    setError('');
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      toast.success('JSON copied to clipboard.');
    } catch {
      setCopied(false);
      setError('Could not access the clipboard. The JSON is selected so you can copy it manually.');
      selectJsonText(textRef.current);
    }
  }

  return <Modal ref={dialogRef} className="forms-schema-dialog" aria-labelledby="forms-schema-title" aria-describedby="forms-schema-description" onClose={() => {
    if (!dialogRef.current?.open) {
      onClose();
    }
  }}>
<Modal.Header as="header"><h2 id="forms-schema-title"><Braces size={20} aria-hidden="true" />JSON schema</h2><button type="button" aria-label="Close JSON schema" onClick={onClose}><X size={18} aria-hidden="true" /></button></Modal.Header>
<Modal.Body>
<p id="forms-schema-description">Current form definition, including unsaved changes, nested layouts, and conditional rules.</p>
<JsonViewer ref={textRef} label="Form JSON schema" json={json} />
</Modal.Body>
<Modal.Footer as="footer"><button type="button" className="forms-primary" onClick={() => { void copy(); }}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}Copy JSON</button></Modal.Footer>
</Modal>;
}
