import { useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

type Option = { value: string; label: string; group?: string };

export function SearchableSelect({ label, value, options, onChange }: {
  label: string; value: string; options: Option[]; onChange: (value: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const matches = options.filter(option => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  const activeIndex = Math.min(active, matches.length - 1);
  const groups = [...new Set(matches.map(option => option.group))];
  function show() { setQuery(''); setActive(0); setOpen(true); }
  function choose(option: Option) { onChange(option.value); setOpen(false); }
  return <div className="searchable-select" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label htmlFor={id}>{label}</label>
    <div className="searchable-select-control">
      <input ref={input} id={id} role="combobox" autoComplete="off" aria-autocomplete="list"
        aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        value={open ? query : options.find(option => option.value === value)?.label ?? ''}
        placeholder={open ? `Search ${label.toLowerCase()}…` : undefined}
        onFocus={show} onClick={() => { if (!open) show(); }}
        onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) show();
            else setActive(Math.max(0, Math.min(matches.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1))));
          }
          if (event.key === 'Enter' && open) { event.preventDefault(); if (matches[activeIndex]) choose(matches[activeIndex]); }
        }} />
      <ChevronDown size={15} aria-hidden="true" />
    </div>
    {open && <div id={`${id}-list`} role="listbox" aria-label={label} className="searchable-select-menu">
      {groups.map(group => <div key={group ?? 'ungrouped'} role={group ? 'group' : undefined} aria-label={group}>
        {group && <div className="searchable-select-group">{group}</div>}
        {matches.filter(option => option.group === group).map(option => {
          const index = matches.indexOf(option);
          return <div key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={option.value === value}
            className={`searchable-select-option ${index === activeIndex ? 'active' : ''}`}
            ref={node => { if (index === activeIndex) node?.scrollIntoView({ block: 'nearest' }); }}
            onMouseDown={event => event.preventDefault()} onClick={() => { choose(option); input.current?.focus(); }}>
            {option.label}{option.value === value && <Check size={14} aria-hidden="true" />}
          </div>;
        })}
      </div>)}
      {!matches.length && <div className="searchable-select-empty" role="status">No matches found.</div>}
    </div>}
  </div>;
}
