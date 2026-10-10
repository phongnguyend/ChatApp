import type { FormNode } from './formModel';

export function FormCodeBlock({ node }: { node: FormNode }) {
  return <div className="form-code-block">
    {node.label && <h3>{node.label}</h3>}
    {node.description && <p>{node.description}</p>}
    <span className="form-code-language">{node.codeLanguage ?? 'text'}</span>
    <pre tabIndex={0} aria-label={node.label || 'Code block'} className={node.codeWrap ? 'wrap-code' : undefined}><code>{node.code || 'Enter code in block settings'}</code></pre>
  </div>;
}
