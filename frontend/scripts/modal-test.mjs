import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const errors = [];
function visitFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      visitFiles(file);
      continue;
    }
    if (!/\.tsx?$/.test(file)) {
      continue;
    }
    const source = readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const shared = relative(root, file).replaceAll('\\', '/') === 'components/Modal.tsx';
    function fail(node, message) {
      const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
      errors.push(`${relative(root, file)}:${line}: ${message}`);
    }
    function check(node) {
      if (ts.isCallExpression(node)) {
        const target = node.expression;
        const name = ts.isIdentifier(target) ? target.text : ts.isPropertyAccessExpression(target) ? target.name.text : '';
        if (['alert', 'confirm', 'prompt'].includes(name)) {
          fail(node, 'Use services/dialogs helpers instead of browser popups.');
        }
        if (name === 'showModal' && !shared) {
          fail(node, 'Modal lifecycle belongs in components/Modal.tsx.');
        }
        if (name === 'addEventListener' && node.arguments.some(argument => ts.isStringLiteral(argument) && argument.text === 'beforeunload')) {
          fail(node, 'Browser leave-confirmation popups are not allowed.');
        }
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (node.tagName.getText(tree) === 'dialog' && !shared) {
          fail(node, 'Use the shared Modal instead of a raw dialog.');
        }
      }
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'Modal') {
        const text = node.getText(tree);
        const hasTitle = node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.text === 'title');
        if (!hasTitle && !text.includes('Modal.Header') && !text.includes('AccountDialogHeader')) {
          fail(node, 'Modal needs a shared Header.');
        }
        if (!text.includes('Modal.Body')) {
          fail(node, 'Modal needs a shared Body.');
        }
      }
      ts.forEachChild(node, check);
    }
    check(tree);
  }
}
visitFiles(root);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Modal audit passed: shared sections and lifecycle; no browser popups.');
}
