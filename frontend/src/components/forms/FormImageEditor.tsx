import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import type { FormNode } from './formModel';

export function FormImageEditor({ node, onChange }: { node: FormNode; onChange: (change: Partial<FormNode>) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef(onChange);
  const sequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => { changeRef.current = onChange; }, [onChange]);
  useEffect(() => () => { sequence.current++; }, []);

  async function load(file: File) {
    const request = ++sequence.current;
    setError('');
    setBusy(true);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        throw new Error('Choose a PNG, JPEG, or WebP image.');
      }
      if (file.size === 0 || file.size > 1024 * 1024) {
        throw new Error('Choose an image up to 1 MiB.');
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read the image. Please try again.'));
        reader.readAsDataURL(file);
      });
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      if (image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 16_000_000) {
        throw new Error('Resize the image to at most 8192 pixels per side and 16 megapixels.');
      }
      if (request === sequence.current) {
        changeRef.current({ imageDataUrl: dataUrl });
      }
    } catch (reason) {
      if (request === sequence.current) {
        setError(reason instanceof Error ? reason.message : 'Could not load this image.');
      }
    } finally {
      if (request === sequence.current) {
        setBusy(false);
      }
    }
  }

  return <div className="forms-image-editor">
    <div className="forms-image-drop" role="group" aria-label="Image upload area" tabIndex={0}
      onDragOver={event => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onDrop={event => {
        event.preventDefault();
        event.stopPropagation();
        const file = event.dataTransfer.files[0];
        if (file) {
          void load(file);
        }
      }}
      onPaste={event => {
        const file = Array.from(event.clipboardData.items).find(item => item.type.startsWith('image/'))?.getAsFile();
        if (file) {
          event.preventDefault();
          event.stopPropagation();
          void load(file);
        }
      }}>
      <ImagePlus size={24} aria-hidden="true" />
      <p>Drop an image here, or focus this area and paste an image.</p>
      <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}><Upload size={16} aria-hidden="true" />{node.imageDataUrl ? 'Replace image' : 'Upload image'}</button>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload logo or banner" hidden onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) {
          void load(file);
        }
      }} />
      <small>PNG, JPEG, WebP · Up to 1 MiB each, 4 MiB per form</small>
    </div>
    {busy && <p role="status">Loading image…</p>}
    {error && <p role="alert" className="forms-error">{error}</p>}
    <label>Image display<select aria-label="Image display" value={node.imageDisplay ?? 'banner'} onChange={event => onChange({ imageDisplay: event.target.value as 'logo' | 'banner' })}><option value="banner">Banner — full width</option><option value="logo">Logo — centered</option></select></label>
    <label>Image width (px)<input type="number" min={24} max={2400} step={1} placeholder="Auto" value={node.imageWidth ?? ''} aria-describedby="form-image-size-help" onChange={event => onChange({ imageWidth: event.target.value === '' ? null : event.target.valueAsNumber })} /></label>
    <label>Image height (px)<input type="number" min={24} max={1200} step={1} placeholder="Auto" value={node.imageHeight ?? ''} aria-describedby="form-image-size-help" onChange={event => onChange({ imageHeight: event.target.value === '' ? null : event.target.valueAsNumber })} /></label>
    <small id="form-image-size-help">Width: 24–2400 px. Height: 24–1200 px. Leave either empty for automatic sizing. Images fit without cropping or stretching and stay within the available width.</small>
    {node.imageDataUrl && <button type="button" onClick={() => {
      sequence.current++;
      setBusy(false);
      setError('');
      onChange({ imageDataUrl: '' });
    }}><Trash2 size={15} aria-hidden="true" />Remove image</button>}
  </div>;
}
