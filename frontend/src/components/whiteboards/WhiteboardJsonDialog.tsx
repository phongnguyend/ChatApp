import { Modal } from '../Modal';
import { useRef, useState } from 'react';
import { Braces, Check, Copy, X } from 'lucide-react';
import { defaultSheetId, type Board } from './boardModel';
import { JsonViewer } from '../JsonViewer';
import { selectJsonText } from '../jsonViewerSelection';

export function WhiteboardJsonDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const json = JSON.stringify({
    id: board.id, title: board.title, revision: board.revision,
    sheets: board.sheets ?? [{ id: defaultSheetId, name: 'Sheet 1' }], objects: board.objects,
  }, null, 2);

  async function copy() {
    setError('');
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
    } catch {
      setCopied(false);
      setError('Could not access the clipboard. The JSON is selected so you can copy it manually.');
      selectJsonText(textRef.current);
    }
  }
  return <Modal ref={dialogRef} className="whiteboard-json-dialog" aria-labelledby="whiteboard-json-title" aria-describedby="whiteboard-json-description" onKeyDown={event => event.stopPropagation()} onClose={() => {
    if (!dialogRef.current?.open) {
      onClose();
    }
  }}>
<Modal.Header as="header"><h2 id="whiteboard-json-title"><Braces size={20} />Whiteboard JSON</h2><button type="button" aria-label="Close whiteboard JSON" onClick={onClose}><X size={18} /></button></Modal.Header>
<Modal.Body>
<p id="whiteboard-json-description">Snapshot of all sheets and objects when opened, including pending changes and deleted objects. Images are referenced by ID.</p>
<JsonViewer ref={textRef} label="Whiteboard JSON" json={json} />
{error && <p role="alert">{error}</p>}
</Modal.Body>
<Modal.Footer as="footer"><span role="status">{copied ? 'JSON copied to clipboard.' : ''}</span><button type="button" onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}Copy JSON</button></Modal.Footer>
</Modal>;
}
