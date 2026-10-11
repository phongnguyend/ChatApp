import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import { Bold, Italic, Underline, List, ListOrdered, Link, Unlink, ImagePlus, Table, Quote, Code2, Undo2, Redo2, AlignLeft, AlignCenter, AlignRight, AlignJustify, type LucideIcon } from 'lucide-react';
import { isValidLinkUrl } from './formModel';
import { sanitizeFormHtml } from './htmlSanitizer';

export function FormHtmlEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [source, setSource] = useState(false);
  const [error, setError] = useState('');
  const lastValue = useRef(value);
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, isAllowedUri: url => isValidLinkUrl(url) } }), Image, TextAlign.configure({ types: ['heading', 'paragraph'] }), TableKit],
    content: sanitizeFormHtml(value),
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': 'HTML visual editor', 'aria-multiline': 'true' },
      transformPastedHTML: html => sanitizeFormHtml(html),
    },
    onUpdate: ({ editor: current }) => {
      const html = current.isEmpty ? '' : current.getHTML();
      if (html.length > 20000) {
        current.commands.setContent(sanitizeFormHtml(lastValue.current), { emitUpdate: false });
        setError('HTML content must be at most 20,000 characters.');
        return;
      }
      lastValue.current = html;
      setError('');
      onChange(html);
    },
  });
  useEffect(() => {
    if (editor && value !== lastValue.current) {
      lastValue.current = value;
      editor.commands.setContent(sanitizeFormHtml(value), { emitUpdate: false });
    }
  }, [editor, value]);
  function url(kind: 'link' | 'image') {
    if (!editor) {
      return;
    }
    const entered = window.prompt(kind === 'link' ? 'Link URL (https://...)' : 'Image URL (https://...)', kind === 'link' ? String(editor.getAttributes('link').href ?? '') : '');
    if (entered === null) {
      return;
    }
    if (!isValidLinkUrl(entered.trim())) {
      setError('Enter a complete HTTP or HTTPS URL without credentials.');
      return;
    }
    setError('');
    if (kind === 'link') {
      editor.chain().focus().extendMarkRange('link').setLink({ href: entered.trim() }).run();
    } else {
      const alt = window.prompt('Image description (alternative text)', '');
      if (alt !== null) {
        editor.chain().focus().setImage({ src: entered.trim(), alt }).run();
      }
    }
  }
  function button(label: string, Icon: LucideIcon, action: () => void, active = false, disabled = false) {
    return <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={action}><Icon size={16} /></button>;
  }
  return <div className="forms-html-editor">
    <div className="forms-html-modes" role="group" aria-label="HTML editor mode">
      <button type="button" aria-pressed={!source} onClick={() => setSource(false)}>Visual editor</button>
      <button type="button" aria-pressed={source} onClick={() => setSource(true)}><Code2 size={15} />HTML source</button>
    </div>
    {source ? <label>HTML source<textarea aria-label="HTML source" className="forms-code-editor" rows={14} maxLength={20000} spellCheck={false} value={value} onChange={event => onChange(event.target.value)} /></label> : editor && <>
      <div className="forms-html-toolbar" role="group" aria-label="HTML formatting">
        <select aria-label="Text style" value={editor.isActive('heading') ? String(editor.getAttributes('heading').level) : 'paragraph'} onChange={event => {
          if (event.target.value === 'paragraph') {
            editor.chain().focus().setParagraph().run();
          } else {
            editor.chain().focus().setHeading({ level: Number(event.target.value) as 1 | 2 | 3 }).run();
          }
        }}><option value="paragraph">Paragraph</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option></select>
        {button('Bold', Bold, () => { editor.chain().focus().toggleBold().run(); }, editor.isActive('bold'))}
        {button('Italic', Italic, () => { editor.chain().focus().toggleItalic().run(); }, editor.isActive('italic'))}
        {button('Underline', Underline, () => { editor.chain().focus().toggleUnderline().run(); }, editor.isActive('underline'))}
        {button('Bullet list', List, () => { editor.chain().focus().toggleBulletList().run(); }, editor.isActive('bulletList'))}
        {button('Numbered list', ListOrdered, () => { editor.chain().focus().toggleOrderedList().run(); }, editor.isActive('orderedList'))}
        {button('Quote', Quote, () => { editor.chain().focus().toggleBlockquote().run(); }, editor.isActive('blockquote'))}
        {button('Code block', Code2, () => { editor.chain().focus().toggleCodeBlock().run(); }, editor.isActive('codeBlock'))}
        {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight], ['justify', AlignJustify]] as const).map(([alignment, Icon]) => <span key={alignment}>{button(`Align ${alignment}`, Icon, () => { editor.chain().focus().setTextAlign(alignment).run(); }, editor.isActive({ textAlign: alignment }))}</span>)}
        {button('Insert link', Link, () => url('link'))}
        {button('Remove link', Unlink, () => { editor.chain().focus().unsetLink().run(); }, false, !editor.isActive('link'))}
        {button('Insert image', ImagePlus, () => url('image'))}
        {button('Insert table', Table, () => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); })}
        {button('Undo HTML edit', Undo2, () => { editor.chain().focus().undo().run(); }, false, !editor.can().undo())}
        {button('Redo HTML edit', Redo2, () => { editor.chain().focus().redo().run(); }, false, !editor.can().redo())}
      </div>
      {editor.isActive('table') && <div className="forms-html-toolbar">
        <button type="button" onClick={() => editor.chain().focus().addRowAfter().run()}>Add row</button>
        <button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()}>Add column</button>
        <button type="button" onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</button>
        <button type="button" onClick={() => editor.chain().focus().deleteColumn().run()}>Delete column</button>
        <button type="button" onClick={() => editor.chain().focus().deleteTable().run()}>Delete table</button>
      </div>}
      <EditorContent editor={editor} />
      <small>Type or paste formatted text. Visual edits simplify custom HTML; use source mode to preserve advanced markup.</small>
    </>}
    {error && <p role="alert">{error}</p>}
    <small>{value.length.toLocaleString()} / 20,000 HTML characters</small>
  </div>;
}
