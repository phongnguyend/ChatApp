import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import csharp from 'highlight.js/lib/languages/csharp';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import DOMPurify from 'dompurify';

const languages = { javascript, typescript, json, html: xml, xml, css, csharp, python, sql, shell: bash, yaml };
const highlighter = hljs.newInstance();
for (const [name, grammar] of Object.entries(languages)) {
  highlighter.registerLanguage(name, grammar);
}

export function highlightFormCode(code: string, language: string): string | null {
  if (!Object.hasOwn(languages, language)) {
    return null;
  }
  try {
    const html = highlighter.highlight(code, { language, ignoreIllegals: true }).value;
    return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false });
  } catch {
    return null;
  }
}
