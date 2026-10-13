export function selectJsonText(element: HTMLPreElement | null) {
  if (!element) {
    return;
  }
  element.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);
}
