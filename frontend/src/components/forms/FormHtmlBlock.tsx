import { useMemo } from 'react';
import { sanitizeFormHtml } from './htmlSanitizer';
import { type FormNode } from './formModel';

function htmlDocument(source: string): string {
  const clean = sanitizeFormHtml(source);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: http:; base-uri 'none'; form-action 'none'"><style>body{font:16px/1.6 system-ui,sans-serif;margin:12px;overflow-wrap:anywhere;color:#222;background:#fff}img{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px}pre{overflow:auto;white-space:pre}a{color:#087c83}</style></head><body>${clean}</body></html>`;
}

export function FormHtmlBlock({ node }: { node: FormNode }) {
  const source = useMemo(() => htmlDocument(node.html ?? ''), [node.html]);
  return <div className="form-html-block">
    {node.label && <h3>{node.label}</h3>}
    {node.description && <p>{node.description}</p>}
    <iframe title={node.label || 'HTML content'} srcDoc={source} sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" style={{ height: node.htmlHeight ?? 300 }} />
  </div>;
}
