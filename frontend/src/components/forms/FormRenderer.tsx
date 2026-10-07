import { useId, useState } from 'react';
import { FlaskConical, LoaderCircle, Send } from 'lucide-react';
import type { FormEvent } from 'react';
import { type Answers, type FormDefinition, type FormNode, isQuestion, visibleAnswers } from './formModel';
import './Forms.css';

export function FormRenderer({ definition, onSubmit, busy = false, errors = {}, preview = false }: {
  definition: FormDefinition; onSubmit: (answers: Answers) => void; busy?: boolean; errors?: Record<string, string>; preview?: boolean;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const prefix = useId();
  const visible = visibleAnswers(definition.nodes, answers);
  const set = (id: string, values: string[]) => {
    setAnswers(current => visibleAnswers(definition.nodes, { ...current, [id]: values }).answers);
  };
  function render(nodes: FormNode[], structuralColumns = false) {
    return nodes.filter(node => visible.ids.has(node.id)).map(node => {
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
    onSubmit(visible.answers);
  }
  return <form className="form-renderer" onSubmit={submit}>
    <header className="form-cover"><span className="forms-eyebrow">{preview ? 'PREVIEW • NO RESPONSES SAVED' : 'FORM'}</span><h1>{definition.title}</h1><p>{definition.description}</p><small>Fields marked * are required.</small></header>
    <div className="form-stack">{render(definition.nodes)}</div>
    <button className="forms-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="forms-spin" aria-hidden="true" /> : preview ? <FlaskConical size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}{busy ? 'Submitting…' : preview ? 'Test submission' : 'Submit response'}</button>
  </form>;
}
