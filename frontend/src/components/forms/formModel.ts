export type Condition = { questionId: string; operator: string; value: string };
export type FormNode = {
  id: string; kind: string; label: string; description: string; required: boolean;
  options: string[]; min: number | null; max: number | null; children: FormNode[];
  conditionMode: 'all' | 'any'; conditions: Condition[];
};
export type FormDefinition = { title: string; description: string; confirmationMessage: string; nodes: FormNode[] };
export type Answers = Record<string, string[]>;
export type FormDetail = { id: string; title: string; revision: number; isPublished: boolean; publishedVersion: number; shareToken: string; updatedAt: string; definition: FormDefinition };
export type FormSummary = Omit<FormDetail, 'definition'> & { responseCount: number };
export type ResponseRow = { id: string; version: number; submittedAt: string; answers: Answers; definition: FormDefinition };
export type ResponsePage = { total: number; snapshot: string; page: number; pageSize: number; items: ResponseRow[] };

export const questionTypes = [
  ['text', 'Short answer'], ['textarea', 'Long answer'], ['email', 'Email'],
  ['number', 'Number'], ['date', 'Date'], ['time', 'Time'], ['datetime', 'Date & time'], ['radio', 'Single choice'],
  ['checkbox', 'Multiple choice'], ['select', 'Dropdown'], ['rating', 'Rating'], ['yesno', 'Yes / No'],
] as const;
export const isQuestion = (node: FormNode) => node.kind !== 'section' && node.kind !== 'columns';
export function createNode(kind: string): FormNode {
  const node: FormNode = {
    id: crypto.randomUUID(), kind, label: questionTypes.find(([value]) => value === kind)?.[1] ?? (kind === 'section' ? 'Section' : 'Columns'),
    description: '', required: false, options: ['Option 1', 'Option 2'], min: null, max: null,
    children: [], conditionMode: 'all', conditions: [],
  };
  if (kind === 'columns') {
    node.children = [createNode('section'), createNode('section')];
    node.children.forEach((column, index) => { column.label = `Column ${index + 1}`; });
  }
  return node;
}
export function flatten(nodes: FormNode[]): FormNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children)]);
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
