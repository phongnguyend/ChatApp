export type Condition = { questionId: string; operator: string; value: string };
export const defaultAttachmentExtensions = ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf', '.txt', '.csv', '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif'];
export type FormNode = {
  id: string; kind: string; label: string; description: string; required: boolean;
  options: string[]; min: number | null; max: number | null; children: FormNode[];
  conditionMode: 'all' | 'any'; conditions: Condition[];
  imageDataUrl?: string;
  imageDisplay?: 'logo' | 'banner';
  imageHeight?: number | null;
  imageWidth?: number | null;
  allowMultipleFiles?: boolean;
  maxFiles?: number;
  maxFileSizeMb?: number;
  allowedExtensions?: string[];
  linkUrl?: string;
  linkOpenNewTab?: boolean;
  paragraphAlignment?: 'left' | 'center' | 'right' | 'justify';
};
export type FormDefinition = { title: string; description: string; confirmationMessage: string; nodes: FormNode[] };
export type Answers = Record<string, string[]>;
export type FormDetail = { id: string; title: string; revision: number; isPublished: boolean; publishedVersion: number; shareToken: string; updatedAt: string; definition: FormDefinition };
export type FormSummary = Omit<FormDetail, 'definition'> & { responseCount: number };
export type ResponseRow = { id: string; version: number; submittedAt: string; answers: Answers; definition: FormDefinition; attachments?: { id: string; questionId: string; fileName: string; size: number }[] };
export type ResponsePage = { total: number; snapshot: string; page: number; pageSize: number; items: ResponseRow[] };

export const questionTypes = [
  ['text', 'Short answer'], ['textarea', 'Long answer'], ['email', 'Email'],
  ['number', 'Number'], ['date', 'Date'], ['time', 'Time'], ['datetime', 'Date & time'], ['radio', 'Single choice'],
  ['checkbox', 'Multiple choice'], ['select', 'Dropdown'], ['rating', 'Rating'], ['yesno', 'Yes / No'],
  ['attachment', 'Attachment'],
  ['url', 'Website / URL'],
] as const;
export const isQuestion = (node: FormNode) => questionTypes.some(([kind]) => kind === node.kind);
export function createNode(kind: string): FormNode {
  const node: FormNode = {
    id: crypto.randomUUID(), kind, label: questionTypes.find(([value]) => value === kind)?.[1] ?? (kind === 'image' ? 'Image' : kind === 'section' ? 'Section' : 'Columns'),
    description: '', required: false, options: ['Option 1', 'Option 2'], min: null, max: null,
    children: [], conditionMode: 'all', conditions: [],
  };
  if (kind === 'paragraph') {
    node.label = '';
    node.description = 'Add your paragraph text here.';
    node.paragraphAlignment = 'left';
  }
  if (kind === 'image') {
    node.imageDataUrl = '';
    node.imageDisplay = 'banner';
  }
  if (kind === 'link') {
    node.label = 'Learn more';
    node.linkUrl = '';
    node.linkOpenNewTab = true;
  }
  if (kind === 'columns') {
    node.children = [createNode('section'), createNode('section')];
    node.children.forEach((column, index) => { column.label = `Column ${index + 1}`; });
  }
  return node;
}
export function flatten(nodes: FormNode[]): FormNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children)]);
}
export function isValidLinkUrl(value: string): boolean {
  if (value.length > 2048 || !/^https?:\/\//i.test(value) || /[\s\\]/.test(value) || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    return false;
  }
  try {
    const url = new URL(value);
    return !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function updateNode(nodes: FormNode[], id: string, update: (node: FormNode) => FormNode): FormNode[] {
  return nodes.map(node => node.id === id ? update(node) : { ...node, children: updateNode(node.children, id, update) });
}
export function removeNode(nodes: FormNode[], id: string): FormNode[] {
  return nodes.filter(node => node.id !== id).map(node => ({ ...node, children: removeNode(node.children, id) }));
}
export function insertNode(nodes: FormNode[], node: FormNode, parentId: string | null, index: number): FormNode[] {
  if (parentId === null) {
    const result = [...nodes];
    result.splice(index, 0, node);
    return result;
  }
  return updateNode(nodes, parentId, parent => ({ ...parent, children: insertNode(parent.children, node, null, index) }));
}
export function moveNode(nodes: FormNode[], id: string, parentId: string | null, index: number): FormNode[] {
  const node = flatten(nodes).find(item => item.id === id);
  if (!node || flatten([node]).some(item => item.id === parentId)) {
    return nodes;
  }
  const siblings = parentId === null ? nodes : flatten(nodes).find(item => item.id === parentId)?.children ?? [];
  const oldIndex = siblings.findIndex(item => item.id === id);
  return insertNode(removeNode(nodes, id), node, parentId, oldIndex >= 0 && oldIndex < index ? index - 1 : index);
}
export function visibleAnswers(nodes: FormNode[], answers: Answers): { ids: Set<string>; answers: Answers } {
  const ids = new Set<string>();
  const clean: Answers = Object.create(null);
  function visit(items: FormNode[]) {
    for (const node of items) {
      const matches = (condition: Condition) => {
        const values = clean[condition.questionId] ?? [];
        const answered = values.some(value => value.trim() !== '');
        switch (condition.operator) {
          case 'answered': return answered;
          case 'notAnswered': return !answered;
          case 'equals': return answered && values.includes(condition.value);
          case 'notEquals': return answered && !values.includes(condition.value);
          case 'contains': return answered && values.some(value => value.includes(condition.value));
          default: return false;
        }
      };
      if (node.conditions.length > 0 && !(node.conditionMode === 'any' ? node.conditions.some(matches) : node.conditions.every(matches))) {
        continue;
      }
      ids.add(node.id);
      if (isQuestion(node)) {
        clean[node.id] = Object.hasOwn(answers, node.id) ? answers[node.id] : [];
      } else {
        visit(node.children);
      }
    }
  }
  visit(nodes);
  return { ids, answers: clean };
}

export function definitionIssues(definition: FormDefinition): string[] {
  const issues: string[] = [];
  const earlier = new Set<string>();
  const nodes = flatten(definition.nodes);
  if (!definition.title.trim()) {
    issues.push('Give your form a title.');
  }
  if (nodes.length > 200) {
    issues.push('A form can contain at most 200 blocks.');
  }
  function visit(items: FormNode[], depth: number) {
    if (depth > 8) {
      issues.push('Layouts can be nested up to eight levels.');
    }
    for (const node of items) {
      if (node.kind === 'attachment' && (!Number.isInteger(node.maxFiles ?? 10) || (node.maxFiles ?? 10) < 1 || (node.maxFiles ?? 10) > 10)) {
        issues.push(`${node.label}: choose a maximum of 1 to 10 files.`);
      }
      if (node.kind === 'link' && (!node.label.trim() || !!node.linkUrl && !isValidLinkUrl(node.linkUrl))) {
        issues.push(`${node.label || 'Link'}: provide a label and a complete HTTP or HTTPS URL without credentials.`);
      }
      if (node.kind === 'attachment') {
        const size = node.maxFileSizeMb ?? 5;
        if (!Number.isInteger(size) || size < 1 || size > 20) {
          issues.push(`${node.label}: maximum file size must be a whole number between 1 and 20 MB.`);
        }
        const extensions = node.allowedExtensions ?? defaultAttachmentExtensions;
        if (extensions.length < 1 || extensions.length > 50 || extensions.some(extension => !/^\.[a-z0-9]{1,16}$/i.test(extension)) || new Set(extensions.map(extension => extension.toLowerCase())).size !== extensions.length) {
          issues.push(`${node.label}: provide 1–50 unique extensions such as .pdf, .docx, .jpg.`);
        }
      }
      if (node.kind === 'image' && node.imageWidth != null && (!Number.isInteger(node.imageWidth) || node.imageWidth < 24 || node.imageWidth > 2400)) {
        issues.push(`${node.label}: image width must be a whole number from 24 to 2400 pixels, or empty for automatic sizing.`);
      }
      if (node.kind === 'image' && node.imageHeight != null && (!Number.isInteger(node.imageHeight) || node.imageHeight < 24 || node.imageHeight > 1200)) {
        issues.push(`${node.label}: image height must be a whole number from 24 to 1200 pixels, or empty for automatic sizing.`);
      }
      if (node.conditions.some(condition => !earlier.has(condition.questionId))) {
        issues.push(`${node.label}: a condition refers to a missing or later question. Update its logic or move the source question earlier.`);
      }
      if (isQuestion(node)) {
        if (!node.label.trim()) {
          issues.push('Every question needs a label.');
        }
        if (['radio', 'checkbox', 'select'].includes(node.kind) && (node.options.length < 2 || node.options.some(option => !option.trim()) || new Set(node.options).size !== node.options.length)) {
          issues.push(`${node.label}: add at least two unique, nonempty choices.`);
        }
        earlier.add(node.id);
      } else {
        visit(node.children, depth + 1);
      }
    }
  }
  visit(definition.nodes, 1);
  return issues;
}

export function csvCell(value: string): string {
  const safe = /^\s*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
