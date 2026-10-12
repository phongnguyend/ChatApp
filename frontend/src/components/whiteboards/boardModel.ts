export type Point = { x: number; y: number };
export const defaultSheetId = '00000000-0000-0000-0000-000000000000';
export type BoardSheet = { id: string; name: string };
export type BoardObject = {
  id: string; kind: 'path' | 'rectangle' | 'ellipse' | 'line' | 'text' | 'sticky' | 'image';
  x: number; y: number; width: number; height: number; color: string; fill: string;
  strokeWidth: number; text: string; fontSize: number; points: Point[]; imageId?: string | null;
  version: number; deleted: boolean; locked?: boolean; z?: number | null; sheetId?: string;
};
export type Board = { id: string; title: string; revision: number; updatedAt: string; createdById: string; isOwner: boolean; canEdit: boolean; objects: BoardObject[]; sheets?: BoardSheet[] };
export type BoardSummary = Pick<Board, 'id' | 'title' | 'revision' | 'updatedAt' | 'isOwner'>;
export type BoardEdit = { expectedVersion: number; object: BoardObject };
export type BoardUpdate = { boardId: string; revision: number; objects: BoardObject[]; full: boolean; sheets?: BoardSheet[] };
export type Cursor = Point & { boardId: string; sheetId?: string; connectionId: string; name: string; seen: number };
export function withLineEndpoints(item: BoardObject, start: Point, end: Point): BoardObject {
  if (![start.x, start.y, end.x, end.y].every(value => Number.isFinite(value) && Math.abs(value) <= 100000)) {
    throw new Error('Line endpoint positions must be between -100,000 and 100,000.');
  }
  const width = Math.max(1, Math.abs(end.x - start.x));
  const height = Math.max(1, Math.abs(end.y - start.y));
  if (width > 10000 || height > 10000) {
    throw new Error('Line endpoints must be no more than 10,000 units apart on either axis.');
  }
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return { ...item, x, y, width, height, points: [{ x: start.x - x, y: start.y - y }, { x: end.x - x, y: end.y - y }] };
}
export function orderedObjects(objects: BoardObject[]): BoardObject[] {
  return objects.map((object, index) => ({ ...object, z: object.z ?? index }))
    .filter(object => !object.deleted)
    .sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function newObject(kind: BoardObject['kind'], point: Point, color: string, fill: string, strokeWidth: number): BoardObject {
  return { id: crypto.randomUUID(), kind, ...point, width: 160, height: 100, color, fill: kind === 'sticky' ? '#fff3a3' : fill, strokeWidth, text: '', fontSize: 24, points: [], version: 0, deleted: false };
}
export function mergeUpdate(board: Board, update: BoardUpdate): Board {
  if (update.boardId !== board.id || update.revision < board.revision) {
    return board;
  }
  const objects = new Map(board.objects.map(item => [item.id, item]));
  update.objects.forEach(item => objects.set(item.id, item));
  return { ...board, revision: update.revision, sheets: update.sheets ?? board.sheets, objects: update.full ? update.objects : [...objects.values()] };
}
