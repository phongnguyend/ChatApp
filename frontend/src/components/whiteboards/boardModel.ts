export type Point = { x: number; y: number };
export type BoardObject = {
  id: string; kind: 'path' | 'rectangle' | 'ellipse' | 'line' | 'text' | 'sticky' | 'image';
  x: number; y: number; width: number; height: number; color: string; fill: string;
  strokeWidth: number; text: string; fontSize: number; points: Point[]; imageId?: string | null;
  version: number; deleted: boolean; z?: number | null;
};
export type Board = { id: string; title: string; revision: number; updatedAt: string; createdById: string; isOwner: boolean; canEdit: boolean; objects: BoardObject[] };
export type BoardSummary = Pick<Board, 'id' | 'title' | 'revision' | 'updatedAt' | 'isOwner'>;
export type BoardEdit = { expectedVersion: number; object: BoardObject };
export type BoardUpdate = { boardId: string; revision: number; objects: BoardObject[]; full: boolean };
export type Cursor = Point & { boardId: string; connectionId: string; name: string; seen: number };
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
  return { ...board, revision: update.revision, objects: update.full ? update.objects : [...objects.values()] };
}
