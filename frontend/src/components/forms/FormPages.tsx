import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Plus, Settings2, Trash2 } from 'lucide-react';
import { definitionIssues, duplicateFormPage, flatten, isQuestion, type FormDefinition, type FormPage } from './formModel';

export function FormPages({ pages, activeId, definition, onSelect, onChange }: {
  pages: FormPage[];
  activeId: string;
  definition: FormDefinition;
  onSelect: (id: string) => void;
  onChange: (pages: FormPage[], activate?: string) => void;
}) {
  const [settings, setSettings] = useState(false);
  const [deleting, setDeleting] = useState<FormPage | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const index = pages.findIndex(page => page.id === activeId);
  const active = pages[index];
  useEffect(() => {
    tabs.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);
  useEffect(() => {
    const element = dialog.current;
    if (deleting) {
      element?.showModal();
    }
    return () => element?.close();
  }, [deleting]);
  function reorder(offset: number) {
    const next = [...pages];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  }
  // Validate prefixes so cross-page conditions retain their earlier-question context.
  let previousIssues = definitionIssues({ ...definition, nodes: [] }).length;
  const issues = pages.map((_, position) => {
    const count = definitionIssues({ ...definition, nodes: pages.slice(0, position + 1).flatMap(page => page.nodes) }).length;
    const added = count - previousIssues;
    previousIssues = count;
    return added;
  });
  return <div className="forms-pages">
    <div className="forms-pages-toolbar">
      <div className="forms-page-tabs" role="tablist" aria-label="Form pages" ref={tabs}>
        {pages.map((page, position) => <button key={page.id} type="button" role="tab" aria-selected={page.id === activeId}
          tabIndex={page.id === activeId ? 0 : -1} onClick={() => onSelect(page.id)}
          onKeyDown={event => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              event.stopPropagation();
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : (position + (event.key === 'ArrowLeft' ? -1 : 1) + pages.length) % pages.length;
              onSelect(pages[next].id);
              (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
            }
          }}>
          {page.title || `Page ${position + 1}`} <small title="Question count">({flatten(page.nodes).filter(isQuestion).length})</small>
          {issues[position] > 0 && <span className="forms-danger" title="Review this page's validation errors" aria-label={`${issues[position]} validation errors`}>!</span>}
        </button>)}
      </div>
      <button type="button" aria-label="Add page" title="Add page" onClick={() => {
        const page: FormPage = { id: crypto.randomUUID(), title: `Page ${pages.length + 1}`, description: '', nodes: [] };
        onChange([...pages, page], page.id);
        setSettings(true);
      }}><Plus size={17} /></button>
      <button type="button" aria-label="Page settings" title="Page settings" aria-expanded={settings} onClick={() => setSettings(!settings)}><Settings2 size={17} /></button>
    </div>
    {settings && <div className="forms-page-settings">
      <label>Page title<input maxLength={500} value={active.title} placeholder={`Page ${index + 1}`} onChange={event => onChange(pages.map(page => page.id === activeId ? { ...page, title: event.target.value } : page))} /></label>
      <label>Page description<textarea rows={2} maxLength={2000} value={active.description} onChange={event => onChange(pages.map(page => page.id === activeId ? { ...page, description: event.target.value } : page))} /></label>
      <div className="forms-page-actions">
        <button type="button" title="Move page left" aria-label="Move page left" disabled={index === 0} onClick={() => reorder(-1)}><ChevronLeft size={16} /></button>
        <button type="button" title="Move page right" aria-label="Move page right" disabled={index === pages.length - 1} onClick={() => reorder(1)}><ChevronRight size={16} /></button>
        <button type="button" onClick={() => {
          const copy = duplicateFormPage(active);
          onChange([...pages.slice(0, index + 1), copy, ...pages.slice(index + 1)], copy.id);
        }}><Copy size={16} />Duplicate page</button>
        <button type="button" className="forms-danger" disabled={pages.length <= 1} onClick={() => setDeleting(active)}><Trash2 size={16} />Delete page</button>
      </div>
    </div>}
    <dialog ref={dialog} className="forms-page-delete" aria-labelledby="forms-page-delete-title" onCancel={() => setDeleting(null)}>
      <h2 id="forms-page-delete-title">Delete page?</h2>
      <p>Delete “{deleting?.title || 'Page'}” and all its blocks? You can undo this change.</p>
      <div className="forms-page-actions">
        <button type="button" autoFocus onClick={() => setDeleting(null)}>Cancel</button>
        <button type="button" className="forms-danger" onClick={() => {
          const position = pages.findIndex(page => page.id === deleting?.id);
          if (position < 0 || pages.length <= 1) {
            setDeleting(null);
            return;
          }
          const next = pages.filter(page => page.id !== deleting?.id);
          onChange(next, next[Math.min(position, next.length - 1)].id);
          setDeleting(null);
        }}>Delete page</button>
      </div>
    </dialog>
  </div>;
}
