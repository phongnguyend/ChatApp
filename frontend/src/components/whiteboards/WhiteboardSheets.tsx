import { Modal } from '../Modal';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import type { BoardSheet } from './boardModel';

export function WhiteboardSheets({ sheets, activeId, disabled, switchingDisabled, onSelect, onSave }: {
  sheets: BoardSheet[]; activeId: string; disabled: boolean; switchingDisabled: boolean;
  onSelect: (id: string) => void; onSave: (sheets: BoardSheet[], activate?: string) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<BoardSheet | null>(null);
  const deleteDialog = useRef<HTMLDialogElement | null>(null);

  const tabs = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    tabs.current?.querySelector('[aria-selected="true"]')?.closest('.whiteboard-sheet-tab')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, sheets]);
  const index = sheets.findIndex(sheet => sheet.id === activeId);
  function rename() {
    setName(sheets[index].name);
    setRenaming(activeId);
    setError('');
  }
  function reorder(offset: number) {
    const next = [...sheets];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    void onSave(next);
  }
  return <div className="whiteboard-sheets">
    <div className="whiteboard-sheets-toolbar">
    <div ref={tabs} role="tablist" aria-label="Whiteboard sheets" className="whiteboard-sheet-tabs">
      {sheets.map((sheet, position) => <div key={sheet.id} role="presentation" className={`whiteboard-sheet-tab${sheet.id === activeId ? ' is-active' : ''}`}>
        <button type="button" role="tab" title={sheet.name} aria-selected={sheet.id === activeId} tabIndex={sheet.id === activeId ? 0 : -1} disabled={switchingDisabled} onClick={() => onSelect(sheet.id)} onDoubleClick={() => {
        if (!disabled && sheet.id === activeId) {
          rename();
        }
      }} onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? sheets.length - 1 : (position + (event.key === 'ArrowLeft' ? -1 : 1) + sheets.length) % sheets.length;
          onSelect(sheets[next].id);
          tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }
      }}><span className="whiteboard-sheet-tab-title">{sheet.name}</span></button>
        <button type="button" className="whiteboard-sheet-tab-close" aria-label={`Delete sheet: ${sheet.name}`} title="Delete sheet" disabled={disabled || sheets.length <= 1} onClick={() => setDeleting(sheet)}><X size={14} aria-hidden="true" /></button>
      </div>)}
    </div>
    <button type="button" aria-label="Add sheet" title="Add sheet" disabled={disabled || sheets.length >= 50} onClick={() => {
      let number = 1;
      while (sheets.some(sheet => sheet.name.toLowerCase() === `sheet ${number}`)) {
        number++;
      }
      const sheet = { id: crypto.randomUUID(), name: `Sheet ${number}` };
      void onSave([...sheets, sheet], sheet.id);
    }}><Plus size={16} /></button>
    <div className="whiteboard-sheet-tools">
    <button type="button" aria-label="Rename sheet" title="Rename sheet" disabled={disabled} onClick={rename}><Pencil size={16} /></button>
    <button type="button" aria-label="Move sheet left" title="Move sheet left" disabled={disabled || index === 0} onClick={() => reorder(-1)}><ChevronLeft size={16} /></button>
    <button type="button" aria-label="Move sheet right" title="Move sheet right" disabled={disabled || index === sheets.length - 1} onClick={() => reorder(1)}><ChevronRight size={16} /></button>
    </div>
    </div>
    <Modal open={!!deleting} ref={deleteDialog} className="whiteboard-confirm-dialog" aria-labelledby="delete-sheet-title" aria-describedby="delete-sheet-description" onKeyDown={event => event.stopPropagation()} onCancel={() => setDeleting(null)} onClose={() => {
      if (!deleteDialog.current?.open) {
        setDeleting(null);
      }
    }}>
<Modal.Header><h2 id="delete-sheet-title">Delete sheet?</h2></Modal.Header>
<Modal.Body>
<p id="delete-sheet-description">Delete “{deleting?.name}” and all its objects? The owner can recover this sheet from version history.</p>
</Modal.Body>
<Modal.Footer as="div" className="whiteboard-confirm-actions">
        <button type="button" autoFocus onClick={() => setDeleting(null)}>Cancel</button>
        <button type="button" className="whiteboard-danger" disabled={disabled || sheets.length <= 1 || !sheets.some(sheet => sheet.id === deleting?.id)} onClick={async () => {
          if (!deleting || disabled || sheets.length <= 1) {
            return;
          }
          const position = sheets.findIndex(sheet => sheet.id === deleting.id);
          if (position < 0) {
            return;
          }
          const next = sheets.filter(sheet => sheet.id !== deleting.id);
          setDeleting(null);
          await onSave(next, activeId === deleting.id ? next[Math.min(position, next.length - 1)].id : activeId);
          requestAnimationFrame(() => {
            tabs.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
          });
        }}><Trash2 size={16} />Delete sheet</button>
      </Modal.Footer>
</Modal>
    {renaming && <form className="whiteboard-sheet-rename" onSubmit={event => {
      event.preventDefault();
      if (!name.trim() || sheets.some(sheet => sheet.id !== renaming && sheet.name.toLowerCase() === name.trim().toLowerCase())) {
        setError('Use a unique sheet name.');
        return;
      }
      void onSave(sheets.map(sheet => sheet.id === renaming ? { ...sheet, name: name.trim() } : sheet));
      setRenaming(null);
    }}>
      <input aria-label="Sheet name" value={name} maxLength={50} required autoFocus disabled={disabled} onChange={event => setName(event.target.value)} />
      <button type="submit" aria-label="Save sheet name" disabled={disabled}><Check size={16} /></button>
      <button type="button" aria-label="Cancel rename" onClick={() => setRenaming(null)}><X size={16} /></button>
      {error && <span role="alert">{error}</span>}
    </form>}
  </div>;
}
