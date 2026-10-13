import { useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { FormNode } from './formModel';
import { highlightFormCode } from './highlightFormCode';
import { toast } from '../../services/toasts';

export function FormCodeBlock({ node }: { node: FormNode }) {
  const codeRef = useRef<HTMLPreElement>(null);
  const [result, setResult] = useState<{ source: string; status: 'copied' | 'error' } | null>(null);
  const source = node.code ?? '';
  const status = result?.source === source ? result.status : null;
  const code = node.code || 'Enter code in block settings';
  const language = node.codeLanguage ?? 'text';
  const highlighted = useMemo(() => highlightFormCode(code, language), [code, language]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(source);
      setResult({ source, status: 'copied' });
      toast.success('Code copied to clipboard.');
    } catch {
      setResult({ source, status: 'error' });
      toast.error('Could not access the clipboard. The code is selected so you can copy it manually.');
      if (codeRef.current) {
        codeRef.current.focus();
        const range = document.createRange();
        range.selectNodeContents(codeRef.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }
  return <div className="form-code-block">
    {node.label && <h3>{node.label}</h3>}
    {node.description && <p>{node.description}</p>}
    <div className="form-code-toolbar">
      <span className="form-code-language">{language}</span>
      <button type="button" aria-label="Copy code" disabled={!source} onClick={event => {
        event.stopPropagation();
        void copy();
      }}>{status === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{status === 'copied' ? 'Copied' : 'Copy code'}</button>
    </div>
    <pre ref={codeRef} tabIndex={0} aria-label={node.label || 'Code block'} className={node.codeWrap ? 'wrap-code' : undefined}>{highlighted === null ? <code>{code}</code> : <code className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted }} />}</pre>
  </div>;
}
