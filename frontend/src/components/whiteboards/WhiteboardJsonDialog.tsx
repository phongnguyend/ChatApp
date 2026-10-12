import { useEffect, useRef, useState } from 'react';
import { Braces, Check, Copy, X } from 'lucide-react';
import { defaultSheetId, type Board } from './boardModel';

export function WhiteboardJsonDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const json = JSON.stringify({
    id: board.id, title: board.title, revision: board.revision,
    sheets: board.sheets ?? [{ id: defaultSheetId, name: 'Sheet 1' }], objects: board.objects,
  }, null, 2);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
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
  return <dialog ref={dialogRef} className="whiteboard-json-dialog" aria-labelledby="whiteboard-json-title" aria-describedby="whiteboard-json-description" onKeyDown={event => event.stopPropagation()} onClose={() => {
    if (!dialogRef.current?.open) {
      onClose();
    }
  }}>
    <header><h2 id="whiteboard-json-title"><Braces size={20} />Whiteboard JSON</h2><button type="button" aria-label="Close whiteboard JSON" onClick={onClose}><X size={18} /></button></header>
    <p id="whiteboard-json-description">Snapshot of all sheets and objects when opened, including pending changes and deleted objects. Images are referenced by ID.</p>
    <textarea ref={textRef} aria-label="Whiteboard JSON" value={json} readOnly spellCheck={false} wrap="off" />
    {error && <p role="alert">{error}</p>}
    <footer><span role="status">{copied ? 'JSON copied to clipboard.' : ''}</span><button type="button" onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}Copy JSON</button></footer>
  </dialog>;
}
