import { useState } from 'react';
import type { DragEvent } from 'react';
import { ImagePlus, Paperclip, RotateCcw } from 'lucide-react';
import { defaultAttachmentExtensions } from './formModel';
import { FormImageEditor } from './FormImageEditor';
import { AlignLeft, ArrowDown, ArrowUp, CalendarClock, CalendarDays, ChevronDown, CircleDot, Clock, Columns3, GitBranchPlus, GripVertical, Hash, ListChecks, Mail, PanelTop, Plus, Star, ToggleLeft, Trash2, Type, type LucideIcon } from 'lucide-react';
import { createNode, flatten, insertNode, isQuestion, moveNode, questionTypes, removeNode, updateNode, type FormDefinition, type FormNode } from './formModel';

const dragType = 'application/x-chatapp-form-block';

const questionIcons: Record<(typeof questionTypes)[number][0], LucideIcon> = {
  text: Type,
  attachment: Paperclip,
  textarea: AlignLeft,
  email: Mail,
  number: Hash,
  date: CalendarDays,
  time: Clock,
  datetime: CalendarClock,
  radio: CircleDot,
  checkbox: ListChecks,
  select: ChevronDown,
  rating: Star,
  yesno: ToggleLeft,
};

export function FormBuilder({ definition, onChange }: { definition: FormDefinition; onChange: (definition: FormDefinition) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const all = flatten(definition.nodes);
  const selected = all.find(node => node.id === selectedId);
  const parent = selected ? all.find(node => node.children.some(child => child.id === selected.id)) : undefined;
  const structuralColumn = parent?.kind === 'columns';
  const beforeSelected = selected ? all.slice(0, all.indexOf(selected)).filter(isQuestion) : [];
  const changeNodes = (nodes: FormNode[]) => onChange({ ...definition, nodes });
  const patch = (change: Partial<FormNode>) => {
    if (selected) {
      changeNodes(updateNode(definition.nodes, selected.id, node => ({ ...node, ...change })));
    }
  };
  function add(kind: string, parentId: string | null = null, index?: number) {
    const node = createNode(kind);
    const destination = parentId === null ? definition.nodes : all.find(item => item.id === parentId)?.children ?? [];
    changeNodes(insertNode(definition.nodes, node, parentId, index ?? destination.length));
    setSelectedId(node.id);
  }
  function addFromPalette(kind: string) {
    const target = selected?.kind === 'section' ? selected.id : parent?.kind === 'section' ? parent.id : null;
    add(kind, target);
  }
  function drag(event: DragEvent, value: string) {
    event.stopPropagation();
    event.dataTransfer.setData(dragType, value);
    event.dataTransfer.effectAllowed = value.startsWith('new:') ? 'copy' : 'move';
    setDragging(true);
  }
  function drop(event: DragEvent, parentId: string | null, index: number) {
    event.preventDefault();
    event.stopPropagation();
    const value = event.dataTransfer.getData(dragType);
    setDragging(false);
    if (value.startsWith('new:')) {
      const kind = value.slice(4);
      if ([...questionTypes.map(([type]) => type), 'section', 'columns', 'image'].includes(kind)) {
        add(kind, parentId, index);
      }
    } else if (value.startsWith('move:')) {
      changeNodes(moveNode(definition.nodes, value.slice(5), parentId, index));
    }
  }
  function dropZone(parentId: string | null, index: number, empty = false) {
    return <div key={`drop-${index}`} className={`forms-drop ${dragging ? 'is-dragging' : ''} ${empty ? 'is-empty' : ''}`}
      onDragOver={event => {
        if (event.dataTransfer.types.includes(dragType)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }} onDrop={event => drop(event, parentId, index)}>
      {empty ? 'Drop a question or layout here' : 'Drop here'}
    </div>;
  }
  function renderList(nodes: FormNode[], parentId: string | null) {
    return <div className="forms-block-list">{dropZone(parentId, 0, nodes.length === 0)}{nodes.map((node, index) => <div key={node.id}>
      <article className={`forms-block ${selectedId === node.id ? 'selected' : ''}`}>
        <div className="forms-block-toolbar">
          <button type="button" className="forms-drag-handle" draggable onDragStart={event => drag(event, `move:${node.id}`)} onDragEnd={() => setDragging(false)} aria-label={`Drag ${node.label}`} title="Drag to move; or use the arrow buttons"><GripVertical size={16} /></button>
          <button className="forms-block-select" type="button" onClick={() => setSelectedId(node.id)}><span>{node.kind === 'image' ? 'Logo / banner' : isQuestion(node) ? questionTypes.find(([kind]) => kind === node.kind)?.[1] : node.kind === 'columns' ? `${node.children.length} columns` : 'Section'}</span><strong>{node.label || 'Untitled question'}{node.required && ' *'}</strong>{node.conditions.length > 0 && <small>Conditional · {node.conditions.length} rule{node.conditions.length > 1 ? 's' : ''}</small>}</button>
          <button type="button" disabled={index === 0} aria-label={`Move ${node.label} up`} onClick={() => changeNodes(moveNode(definition.nodes, node.id, parentId, index - 1))}><ArrowUp size={15} /></button>
          <button type="button" disabled={index === nodes.length - 1} aria-label={`Move ${node.label} down`} onClick={() => changeNodes(moveNode(definition.nodes, node.id, parentId, index + 2))}><ArrowDown size={15} /></button>
        </div>
        {node.kind === 'image' ? <button className="forms-image-preview" type="button" onClick={() => setSelectedId(node.id)} aria-label={`Edit image ${node.label}`}>
          {node.imageDataUrl ? <img className={`form-image form-image-${node.imageDisplay ?? 'banner'}`} style={{ width: node.imageWidth ?? undefined, height: node.imageHeight ?? undefined, maxWidth: node.imageWidth != null ? '100%' : undefined, maxHeight: node.imageHeight != null || node.imageWidth != null ? 'none' : undefined }} src={node.imageDataUrl} alt={node.label} draggable={false} /> : <span><ImagePlus size={24} aria-hidden="true" />Select this block to upload, drop, or paste a logo/banner</span>}
        </button> : isQuestion(node) ? <button className="forms-block-placeholder" type="button" onClick={() => setSelectedId(node.id)}>{['radio', 'checkbox', 'select'].includes(node.kind) ? node.options.join('  ·  ') : node.description || 'Click to edit question settings'}</button>
          : node.kind === 'columns' ? <div className="forms-columns-builder" style={{ gridTemplateColumns: `repeat(${node.children.length}, minmax(0, 1fr))` }}>{node.children.map(column => <div key={column.id} className="forms-column"><button type="button" className="forms-column-title" onClick={() => setSelectedId(column.id)}>{column.label}</button>{renderList(column.children, column.id)}</div>)}</div>
            : <div className="forms-section-builder">{renderList(node.children, node.id)}</div>}
      </article>{dropZone(parentId, index + 1)}
    </div>)}</div>;
  }
  const forbiddenDestinations = selected ? new Set(flatten([selected]).map(node => node.id)) : new Set<string>();
  return <div className="forms-builder">
    <aside className="forms-palette"><h3>Add blocks</h3><p>Drag onto the canvas, or select a section and click a block.</p>
      {questionTypes.map(([kind, label]) => {
        const Icon = questionIcons[kind];
        return <button type="button" key={kind} draggable onDragStart={event => drag(event, `new:${kind}`)} onDragEnd={() => setDragging(false)} onClick={() => addFromPalette(kind)}><Icon size={15} aria-hidden="true" />{label}</button>;
      })}
      <h3>Content</h3><button type="button" draggable onDragStart={event => drag(event, 'new:image')} onDragEnd={() => setDragging(false)} onClick={() => addFromPalette('image')}><ImagePlus size={15} aria-hidden="true" />Logo / banner</button>
      <h3>Layout</h3>{[['section', 'Section'], ['columns', 'Columns']].map(([kind, label]) => <button type="button" key={kind} draggable onDragStart={event => drag(event, `new:${kind}`)} onDragEnd={() => setDragging(false)} onClick={() => addFromPalette(kind)}>{kind === 'section' ? <PanelTop size={15} aria-hidden="true" /> : <Columns3 size={15} aria-hidden="true" />}{label}</button>)}
    </aside>
    <div className="forms-canvas" role="region" aria-label="Form canvas" tabIndex={0}>
      <div className="forms-cover-editor"><span className="forms-eyebrow">FORM DETAILS</span>
        <label>Title<input maxLength={200} value={definition.title} onChange={event => onChange({ ...definition, title: event.target.value })} /></label>
        <label>Description<textarea rows={2} maxLength={4000} value={definition.description} onChange={event => onChange({ ...definition, description: event.target.value })} placeholder="Tell people what this form is for" /></label>
      </div>
      {renderList(definition.nodes, null)}
      <label className="forms-confirmation">Confirmation message<textarea rows={2} maxLength={2000} value={definition.confirmationMessage} onChange={event => onChange({ ...definition, confirmationMessage: event.target.value })} /></label>
    </div>
    <aside className="forms-inspector"><h3>Block settings</h3>{!selected ? <p>Select a question or layout to edit its settings and conditional logic.</p> : <>
      <label>{selected.kind === 'image' ? 'Alternative text' : isQuestion(selected) ? 'Question' : 'Layout label'}<input maxLength={500} value={selected.label} onChange={event => patch({ label: event.target.value })} /></label>
      {selected.kind === 'image' && <FormImageEditor key={selected.id} node={selected} onChange={patch} />}
      <label>Description<textarea maxLength={2000} rows={3} value={selected.description} onChange={event => patch({ description: event.target.value })} /></label>
      {isQuestion(selected) && <label className="forms-inline"><input type="checkbox" checked={selected.required} onChange={event => patch({ required: event.target.checked })} />Required answer</label>}
      {selected.kind === 'attachment' && <>
        <label>Maximum file size (MB)<input type="number" min={1} max={20} step={1} value={selected.maxFileSizeMb ?? 5} onChange={event => patch({ maxFileSizeMb: Number(event.target.value) })} /></label>
        <label>Allowed extensions<textarea rows={4} value={(selected.allowedExtensions ?? defaultAttachmentExtensions).join(', ')} onChange={event => patch({ allowedExtensions: event.target.value.split(',').map(extension => extension.trim().toLowerCase()) })} /></label>
        <small>Separate extensions with commas, including the dot (for example .pdf, .docx, .jpg).</small>
        <button type="button" onClick={() => patch({ allowedExtensions: [...defaultAttachmentExtensions] })}><RotateCcw size={15} aria-hidden="true" />Reset file types</button>
        <label className="forms-inline"><input type="checkbox" checked={selected.allowMultipleFiles ?? false} onChange={event => patch({ allowMultipleFiles: event.target.checked })} />Allow multiple files</label>
        {selected.allowMultipleFiles && <label>Maximum files<input type="number" min={1} max={10} value={selected.maxFiles ?? 10} onChange={event => patch({ maxFiles: Number(event.target.value) })} /></label>}
        <p className="forms-muted">Choose 1–20 MB per file (1 MB = 1,048,576 bytes). The total limit is 20 MB per response. Files are available only to the form owner.</p>
      </>}
      {['radio', 'checkbox', 'select'].includes(selected.kind) && <div className="forms-choice-editor"><h4>Choices</h4>{selected.options.map((option, index) => <div key={index}><input aria-label={`Option ${index + 1}`} value={option} maxLength={300} onChange={event => patch({ options: selected.options.map((value, current) => current === index ? event.target.value : value) })} /><button type="button" aria-label={`Remove option ${index + 1}`} onClick={() => patch({ options: selected.options.filter((_, current) => current !== index) })}><Trash2 size={14} /></button></div>)}<button type="button" disabled={selected.options.length >= 100} onClick={() => patch({ options: [...selected.options, `Option ${selected.options.length + 1}`] })}><Plus size={15} aria-hidden="true" />Add choice</button></div>}
      {selected.kind === 'number' && <div className="forms-range"><label>Minimum<input type="number" step="any" value={selected.min ?? ''} onChange={event => patch({ min: event.target.value === '' ? null : Number(event.target.value) })} /></label><label>Maximum<input type="number" step="any" value={selected.max ?? ''} onChange={event => patch({ max: event.target.value === '' ? null : Number(event.target.value) })} /></label></div>}
      {selected.kind === 'rating' && <label>Rating scale<select value={selected.max ?? 5} onChange={event => patch({ max: Number(event.target.value) })}>{Array.from({ length: 9 }, (_, index) => <option key={index} value={index + 2}>1 to {index + 2}</option>)}</select></label>}
      {selected.kind === 'columns' && <><p>Each column is a section. Select it to add questions or nest another column layout.</p><button type="button" disabled={selected.children.length >= 4} onClick={() => patch({ children: [...selected.children, { ...createNode('section'), label: `Column ${selected.children.length + 1}` }] })}><Plus size={15} aria-hidden="true" />Add column</button><button type="button" disabled={selected.children.length <= 2 || selected.children.at(-1)!.children.length > 0} onClick={() => patch({ children: selected.children.slice(0, -1) })}><Trash2 size={15} aria-hidden="true" />Remove last empty column</button></>}
      <div className="forms-logic"><h4>Conditional visibility</h4><p>Show this block when earlier answers match. Hidden answers are excluded from submissions.</p>
        <label>Match<select value={selected.conditionMode} onChange={event => patch({ conditionMode: event.target.value as 'all' | 'any' })}><option value="all">All conditions</option><option value="any">Any condition</option></select></label>
        {selected.conditions.map((condition, index) => <div className="forms-condition" key={index}>
          <label>Question<select aria-label="Condition question" value={condition.questionId} onChange={event => patch({ conditions: selected.conditions.map((value, current) => current === index ? { ...value, questionId: event.target.value } : value) })}><option value="">Choose an earlier question</option>{beforeSelected.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
          <label>Operator<select value={condition.operator} onChange={event => patch({ conditions: selected.conditions.map((value, current) => current === index ? { ...value, operator: event.target.value } : value) })}>{[['equals', 'Equals'], ['notEquals', 'Does not equal'], ['contains', 'Contains'], ['answered', 'Is answered'], ['notAnswered', 'Is not answered']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {!['answered', 'notAnswered'].includes(condition.operator) && <label>Value (case sensitive)<input value={condition.value} maxLength={4000} list={`choices-${selected.id}-${index}`} onChange={event => patch({ conditions: selected.conditions.map((value, current) => current === index ? { ...value, value: event.target.value } : value) })} /><datalist id={`choices-${selected.id}-${index}`}>{(all.find(node => node.id === condition.questionId)?.options ?? []).map(option => <option key={option} value={option} />)}</datalist></label>}
          <button type="button" onClick={() => patch({ conditions: selected.conditions.filter((_, current) => current !== index) })}><Trash2 size={15} aria-hidden="true" />Remove condition</button>
        </div>)}
        <button type="button" disabled={beforeSelected.length === 0 || selected.conditions.length >= 20} onClick={() => patch({ conditions: [...selected.conditions, { questionId: beforeSelected[0]?.id ?? '', operator: 'equals', value: '' }] })}><GitBranchPlus size={15} aria-hidden="true" />Add condition</button>
      </div>
      {!structuralColumn && <><label>Move into<select value={parent?.id ?? ''} onChange={event => {
        const destination = event.target.value || null;
        const length = destination ? all.find(node => node.id === destination)!.children.length : definition.nodes.length;
        changeNodes(moveNode(definition.nodes, selected.id, destination, length));
      }}><option value="">Form root</option>{all.filter(node => node.kind === 'section' && !forbiddenDestinations.has(node.id)).map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
        <button type="button" className="forms-danger" onClick={() => {
          if (selected.children.length > 0 && !window.confirm('Remove this layout and all blocks inside it? You can undo this change.')) {
            return;
          }
          changeNodes(removeNode(definition.nodes, selected.id));
          setSelectedId(null);
        }}><Trash2 size={15} />Delete block</button></>}
    </>}</aside>
  </div>;
}
