import { memo, useMemo, type Ref } from 'react';
import { selectJsonText } from './jsonViewerSelection';
import './JsonViewer.css';

export const JsonViewer = memo(function JsonViewer({ json, label, ref }: { json: string; label: string; ref?: Ref<HTMLPreElement> }) {
  const highlighted = useMemo(() => json.split(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:])/g).map((token, index) => {
    if (index % 2 === 0) {
      return token;
    }
    const kind = token.startsWith('"') ? token.endsWith(':') ? 'key' : 'string'
      : token === 'null' ? 'null' : token === 'true' || token === 'false' ? 'boolean'
      : /^-?\d/.test(token) ? 'number' : 'punctuation';
    // Render tokens as text so JSON containing HTML stays inert.
    return <span key={index} className={`json-token-${kind}`}>{token}</span>;
  }), [json]);
  return <pre ref={ref} className="json-viewer" role="textbox" aria-label={label} aria-readonly="true" aria-multiline="true" tabIndex={0} onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectJsonText(event.currentTarget);
    }
  }}><code>{highlighted}</code></pre>;
});
