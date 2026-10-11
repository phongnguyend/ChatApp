import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isValidLinkUrl, type FormNode } from './formModel';

export function FormMarkdownBlock({ node }: { node: FormNode }) {
  return <div className="form-markdown-block">
    {node.label && <h3>{node.label}</h3>}
    {node.description && <p>{node.description}</p>}
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ href, children }) => href && (isValidLinkUrl(href) || href.startsWith('#'))
        ? <a href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>
        : <span>{children}</span>,
      img: ({ src, alt }) => src && isValidLinkUrl(src)
        ? <img src={src} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" />
        : <span>{alt}</span>,
    }}>{node.markdown || 'Enter Markdown in block settings.'}</Markdown>
  </div>;
}
