import DOMPurify from 'dompurify';
import { isValidLinkUrl } from './formModel';
const allowedStyles = new Set(['color', 'background-color', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-align', 'text-decoration', 'line-height', 'white-space', 'border', 'border-color', 'border-width', 'border-style', 'border-radius', 'border-collapse', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'width', 'max-width', 'height']);

export function sanitizeFormHtml(source: string): string {
  const fragment = DOMPurify.sanitize(source, {
    ALLOWED_TAGS: ['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'small', 'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'style', 'colspan', 'rowspan', 'scope'],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  for (const element of fragment.querySelectorAll<HTMLElement>('*')) {
    const styles = [...element.style].map(property => [property, element.style.getPropertyValue(property)]);
    element.removeAttribute('style');
    for (const [property, value] of styles) {
      if (allowedStyles.has(property) && !/url|expression|var\(|[\\@]/i.test(value)) {
        element.style.setProperty(property, value);
      }
    }
    for (const attribute of ['href', 'src']) {
      const value = element.getAttribute(attribute);
      if (value !== null && !isValidLinkUrl(value)) {
        element.removeAttribute(attribute);
      }
    }
    if (element.tagName === 'A') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
    if (element.tagName === 'IMG') {
      element.setAttribute('referrerpolicy', 'no-referrer');
    }
  }
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}
