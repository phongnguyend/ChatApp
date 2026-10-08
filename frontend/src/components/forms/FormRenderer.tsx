import { useId, useState } from 'react';
import { FlaskConical, LoaderCircle, Send } from 'lucide-react';
import type { FormEvent } from 'react';
import { type Answers, type FormDefinition, type FormNode, isQuestion, visibleAnswers } from './formModel';
import './Forms.css';
import { FormAttachmentInput } from './FormAttachmentInput';
import { defaultAttachmentExtensions } from './formModel';

export function FormRenderer({ definition, onSubmit, onUploadFile, busy = false, errors = {}, preview = false }: {
  definition: FormDefinition; onSubmit: (answers: Answers, files: Record<string, File[]>) => void; busy?: boolean; errors?: Record<string, string>; preview?: boolean;
  onUploadFile?: (questionId: string, file: File) => Promise<void>;
}) {
  const [{ answers, files }, setState] = useState<{ answers: Answers; files: Record<string, File[]> }>({ answers: {}, files: {} });
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const prefix = useId();
  const visible = visibleAnswers(definition.nodes, answers);
  const set = (id: string, values: string[], attachments?: File[]) => {
    setState(current => {
      const clean = visibleAnswers(definition.nodes, { ...current.answers, [id]: values });
      const nextFiles = attachments === undefined ? current.files : { ...current.files, [id]: attachments };
      return { answers: clean.answers, files: Object.fromEntries(Object.entries(nextFiles).filter(([key]) => clean.ids.has(key))) };
    });
  };
  function render(nodes: FormNode[], structuralColumns = false) {
    return nodes.filter(node => visible.ids.has(node.id)).map(node => {
      if (node.kind === 'image') {
        return node.imageDataUrl ? <figure key={node.id} className="form-image-block"><img className={`form-image form-image-${node.imageDisplay ?? 'banner'}`} style={{ width: node.imageWidth ?? undefined, height: node.imageHeight ?? undefined, maxWidth: node.imageWidth != null ? '100%' : undefined, maxHeight: node.imageHeight != null || node.imageWidth != null ? 'none' : undefined }} src={node.imageDataUrl} alt={node.label} draggable={false} />{node.description && <figcaption>{node.description}</figcaption>}</figure> : null;
      }
      if (!isQuestion(node)) {
        return <section key={node.id} className={`form-layout form-layout-${node.kind}`}>
          {node.kind === 'section' && !structuralColumns && <><h3>{node.label}</h3>{node.description && <p>{node.description}</p>}</>}
          <div className={node.kind === 'columns' ? 'form-columns' : 'form-stack'} style={node.kind === 'columns' ? { gridTemplateColumns: `repeat(${node.children.length}, minmax(0, 1fr))` } : undefined}>{render(node.children, node.kind === 'columns')}</div>
        </section>;
      }
      const id = `${prefix}-${node.id}`;
      const values = Object.hasOwn(answers, node.id) ? answers[node.id] : [];
      const value = values[0] ?? '';
      const common = { id, required: node.required, 'aria-label': node.label, 'aria-invalid': !!errors[node.id], 'aria-describedby': `${id}-help ${id}-error`, disabled: busy };
      const choices = node.kind === 'yesno' ? ['Yes', 'No'] : node.kind === 'rating' ? Array.from({ length: node.max ?? 5 }, (_, index) => String(index + 1)) : node.options;
      let input;
      if (['radio', 'checkbox', 'yesno', 'rating'].includes(node.kind)) {
        input = <div className={node.kind === 'rating' ? 'form-rating' : 'form-options'}>{choices.map((option, index) => <label key={option} className="form-choice">
          <input type={node.kind === 'checkbox' ? 'checkbox' : 'radio'} name={id} value={option} checked={values.includes(option)} disabled={busy}
            required={node.required && (node.kind !== 'checkbox' || values.length === 0 && index === 0)}
            aria-describedby={`${id}-help ${id}-error`}
            onChange={event => set(node.id, node.kind === 'checkbox' ? event.target.checked ? [...values, option] : values.filter(item => item !== option) : [option])} />
          <span>{option}</span>
        </label>)}</div>;
      } else if (node.kind === 'attachment') {
        const selectedFiles = files[node.id] ?? [];
        const limit = node.allowMultipleFiles ? node.maxFiles ?? 10 : 1;
        const extensions = node.allowedExtensions ?? defaultAttachmentExtensions;
        const maxFileSizeMb = node.maxFileSizeMb ?? 5;
        input = <FormAttachmentInput id={id} label={node.label} required={node.required} invalid={!!errors[node.id]}
          describedBy={`${id}-help ${id}-error`} files={selectedFiles} limit={limit} multiple={node.allowMultipleFiles ?? false}
          extensions={extensions} maxFileSizeMb={maxFileSizeMb} disabled={busy || uploading} uploaded={!!onUploadFile} onSelect={async picked => {
            if (picked.some(file => !extensions.some(extension => file.name.toLowerCase().endsWith(extension.toLowerCase())))) {
              throw new Error(`File extension is not allowed. Choose: ${extensions.join(', ')}.`);
            }
            const next = node.allowMultipleFiles ? [...selectedFiles, ...picked] : picked;
            if (next.length > limit) {
              throw new Error(`Choose up to ${limit} file${limit === 1 ? '' : 's'} for this question.`);
            }
            if (picked.some(file => file.size > maxFileSizeMb * 1024 * 1024)) {
              throw new Error(`Each file must be at most ${maxFileSizeMb} MB.`);
            }
            const otherSize = Object.entries(files).filter(([key]) => key !== node.id).flatMap(([, items]) => items).reduce((sum, file) => sum + file.size, 0);
            if (otherSize + next.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) {
              throw new Error('Attachments must total at most 20 MiB. Remove some files first.');
            }
            setUploadError('');
            setUploading(true);
            const completed = node.allowMultipleFiles ? [...selectedFiles] : [];
            try {
              for (const file of picked) {
                await onUploadFile?.(node.id, file);
                completed.push(file);
                set(node.id, completed.map(item => item.name), [...completed]);
              }
            } finally {
              setUploading(false);
            }
          }} onRemove={index => {
            const next = selectedFiles.filter((_, position) => position !== index);
            setUploadError('');
            set(node.id, next.map(item => item.name), next);
          }} />;
      } else if (node.kind === 'select') {
        input = <select {...common} value={value} onChange={event => set(node.id, [event.target.value])}><option value="">Choose an option</option>{choices.map(option => <option key={option}>{option}</option>)}</select>;
      } else if (node.kind === 'textarea') {
        input = <textarea {...common} maxLength={10000} rows={4} value={value} onChange={event => set(node.id, [event.target.value])} />;
      } else {
        input = <input {...common} type={node.kind === 'datetime' ? 'datetime-local' : ['email', 'number', 'date', 'time'].includes(node.kind) ? node.kind : 'text'} maxLength={node.kind === 'email' ? 254 : 2000}
          min={node.kind === 'number' ? node.min ?? undefined : undefined} max={node.kind === 'number' ? node.max ?? undefined : undefined} step={node.kind === 'number' ? 'any' : ['time', 'datetime'].includes(node.kind) ? 60 : undefined}
          value={value} onChange={event => set(node.id, [event.target.value])} />;
      }
      return <fieldset key={node.id} className="form-question">
        <legend>{node.label}{node.required && <span className="form-required" aria-label="required"> *</span>}</legend>
        {node.description && <p id={`${id}-help`}>{node.description}</p>}
        <div aria-label={node.label}>{input}</div>
        {errors[node.id] && <p id={`${id}-error`} className="forms-error" role="alert">{errors[node.id]}</p>}
      </fieldset>;
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || uploading) {
      return;
    }
    if (Object.values(files).flat().reduce((total, file) => total + file.size, 0) > 20 * 1024 * 1024) {
      setUploadError('Attachments must total at most 20 MiB. Remove some files before submitting.');
      return;
    }
    setUploadError('');
    onSubmit(visible.answers, files);
  }
  return <form className="form-renderer" onSubmit={submit}>
    <header className="form-cover"><span className="forms-eyebrow">{preview ? 'PREVIEW • NO RESPONSES SAVED' : 'FORM'}</span><h1>{definition.title}</h1><p>{definition.description}</p><small>Fields marked * are required.</small></header>
    <div className="form-stack">{render(definition.nodes)}</div>
    {uploadError && <p className="forms-error" role="alert">{uploadError}</p>}
    {uploading && <p role="status">Uploading files… You can continue filling out the form.</p>}
    <button className="forms-primary" type="submit" disabled={busy || uploading}>{busy || uploading ? <LoaderCircle size={16} className="forms-spin" aria-hidden="true" /> : preview ? <FlaskConical size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}{uploading ? 'Uploading files…' : busy ? 'Submitting…' : preview ? 'Test submission' : 'Submit response'}</button>
  </form>;
}
