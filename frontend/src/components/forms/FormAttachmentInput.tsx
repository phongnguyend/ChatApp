import { useRef, useState } from 'react';
import { CheckCircle2, File, FileImage, FileText, LoaderCircle, Trash2, UploadCloud } from 'lucide-react';

function fileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function FormAttachmentInput({ id, label, required, invalid, describedBy, files, limit, multiple, extensions, maxFileSizeMb, disabled, uploaded, onSelect, onRemove }: {
  id: string; label: string; required: boolean; invalid: boolean; describedBy: string; files: File[];
  limit: number; multiple: boolean; disabled: boolean; uploaded: boolean;
  extensions: string[];
  maxFileSizeMb: number;
  onSelect: (files: File[]) => Promise<void>; onRemove: (index: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const browse = useRef<HTMLButtonElement>(null);
  const dragDepth = useRef(0);
  const selecting = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const [error, setError] = useState('');
  async function select(picked: File[]) {
    if (disabled || selecting.current || picked.length === 0) {
      return;
    }
    selecting.current = true;
    setError('');
    setPending(picked);
    try {
      await onSelect(picked);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Upload failed. Please choose the file again.');
    } finally {
      setPending([]);
      selecting.current = false;
    }
  }
  return <div className="form-attachment-input">
    <div className={`form-attachment-dropzone${dragging && !disabled ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}`}
      role="group" aria-label={`Upload files for ${label}`} aria-describedby={`${id}-limits`} aria-busy={pending.length > 0}
      onDragEnter={event => {
        event.preventDefault();
        if (event.dataTransfer.types.includes('Files')) {
          dragDepth.current++;
          setDragging(true);
        }
      }} onDragOver={event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      }} onDragLeave={event => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) {
          setDragging(false);
        }
      }} onDrop={event => {
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        void select(Array.from(event.dataTransfer.files));
      }}>
      <span className="form-attachment-upload-icon"><UploadCloud size={25} aria-hidden="true" /></span>
      <div className="form-attachment-prompt"><strong>{dragging && !disabled ? 'Drop files here' : multiple ? 'Drag and drop your files here' : 'Drag and drop your file here'}</strong><span>or browse from your device</span></div>
      <button ref={browse} type="button" disabled={disabled} aria-label={`Browse files for ${label}`} onClick={() => input.current?.click()}><UploadCloud size={16} aria-hidden="true" />{!multiple && files.length > 0 ? 'Replace file' : 'Browse files'}</button>
      <input ref={input} id={id} className="form-attachment-native" type="file" tabIndex={-1} aria-label={label}
        accept={extensions.join(',')} multiple={multiple} disabled={disabled} required={required && files.length === 0} aria-invalid={invalid || !!error}
        aria-describedby={`${describedBy} ${id}-limits ${id}-upload-error`} onInvalid={event => {
          event.preventDefault();
          setError('Please choose a file.');
          browse.current?.focus();
        }} onChange={event => {
          const picked = Array.from(event.target.files ?? []);
          event.target.value = '';
          void select(picked);
        }} />
    </div>
    <div className="form-attachment-limits" id={`${id}-limits`}><span>Up to {limit} file{limit === 1 ? '' : 's'} · {maxFileSizeMb} MB each · 20 MB per response</span><span>{files.length} / {limit} selected</span></div>
    <details className="form-attachment-types"><summary>Allowed file types</summary><p>{extensions.join(', ')}</p></details>
    {files.length > 0 && <ul className="form-attachment-list" aria-label={`Selected files for ${label}`}>{files.map((file, index) => {
      const Icon = file.type.startsWith('image/') ? FileImage : file.type.startsWith('text/') || file.type === 'application/pdf' ? FileText : File;
      return <li className="form-attachment-file" key={`${file.name}-${index}`}>
        <span className="form-attachment-file-icon"><Icon size={21} aria-hidden="true" /></span>
        <div className="form-attachment-details"><strong title={file.name}>{file.name}</strong><span>{fileSize(file.size)}<span className="form-attachment-status"><CheckCircle2 size={13} aria-hidden="true" />{uploaded ? 'Uploaded' : 'Ready'}</span></span></div>
        <button type="button" className="form-attachment-remove" disabled={disabled} aria-label={`Remove ${file.name}`} title={`Remove ${file.name}`} onClick={() => {
          setError('');
          onRemove(index);
        }}><Trash2 size={16} aria-hidden="true" /></button>
      </li>;
    })}</ul>}
    {pending.filter(file => !files.includes(file)).map((file, index) => <div className="form-attachment-file form-attachment-pending" key={index} role="status"><LoaderCircle size={20} className="forms-spin" aria-hidden="true" /><div className="form-attachment-details"><strong>{file.name}</strong><span>{uploaded ? 'Uploading…' : 'Preparing…'}</span></div></div>)}
    {error && <p id={`${id}-upload-error`} className="forms-error" role="alert">{error}</p>}
  </div>;
}
