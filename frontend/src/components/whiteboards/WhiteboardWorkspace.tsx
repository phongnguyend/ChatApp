import { promptDialog, confirmDialog } from '../../services/dialogs';
import { toast } from '../../services/toasts';
import { ToastNotice } from '../Toast';
import { useEffect, useRef, useState } from 'react';
import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { ArrowLeft, MousePointer2, Hand, Pencil, Square, Circle, Minus, Type, StickyNote, Eraser, ImagePlus, Undo2, Redo2, Copy, ClipboardPaste, Trash2, Share2, History, Download } from 'lucide-react';
import { API_URL, getAccessToken } from '../../services/auth';
import { BoardError, boardsApi } from '../../services/whiteboardsApi';
import { defaultSheetId, mergeUpdate, newObject, orderedObjects, withLineEndpoints, type Board, type BoardSheet, type BoardEdit, type BoardObject, type BoardUpdate, type Cursor, type Point } from './boardModel';
import { WhiteboardSheets } from './WhiteboardSheets';
import { WhiteboardJsonDialog } from './WhiteboardJsonDialog';
import { BringToFront, SendToBack, ArrowUp, ArrowDown, ArrowLeftRight, Lock, LockOpen, Braces } from 'lucide-react';
import { WhiteboardCanvas, type BoardTool } from './WhiteboardCanvas';

const tools = [['select', 'Select', MousePointer2], ['pan', 'Pan', Hand], ['path', 'Pen', Pencil], ['rectangle', 'Rectangle', Square], ['ellipse', 'Ellipse', Circle], ['line', 'Line', Minus], ['text', 'Text', Type], ['sticky', 'Sticky note', StickyNote], ['eraser', 'Eraser', Eraser]] as const;
type Pending = { operationId: string; edits: BoardEdit[]; mode: 'edit' | 'undo' | 'redo'; before: BoardObject[]; sheets?: BoardSheet[]; expectedRevision?: number };
type Member = { userId: string; username: string; canEdit: boolean };
type Version = { revision: number; createdAt: string };

export function WhiteboardWorkspace({ initial, onBack }: { initial: Board; onBack: () => void }) {
  const [board, setBoard] = useState(initial);
  const [jsonSnapshot, setJsonSnapshot] = useState<Board | null>(null);
  const current = useRef(board);
  const [activeSheet, setActiveSheet] = useState(initial.sheets?.[0]?.id ?? defaultSheetId);
  const activeSheetRef = useRef(activeSheet);
  const sheets = board.sheets ?? [{ id: defaultSheetId, name: 'Sheet 1' }];
  const sheetId = sheets.some(sheet => sheet.id === activeSheet) ? activeSheet : sheets[0].id;
  activeSheetRef.current = sheetId;
  const sheetObjects = board.objects.filter(object => (object.sheetId ?? defaultSheetId) === sheetId);
  const [tool, setTool] = useState<BoardTool>('select');
  const [selected, setSelected] = useState<string[]>([]);
  const [color, setColor] = useState('#1f2937');
  const [fill, setFill] = useState('transparent');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const busyRef = useRef(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [moveDraft, setMoveDraft] = useState<BoardObject[] | null>(null);
  const movement = useRef<{ before: BoardObject[]; objects: BoardObject[] } | null>(null);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldArrows = useRef(new Set<string>());
  const [online, setOnline] = useState(false);
  const [cursors, setCursors] = useState<Cursor[]>([]);
  const [panel, setPanel] = useState<'share' | 'history' | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const undo = useRef<BoardEdit[][]>([]);
  const redo = useRef<BoardEdit[][]>([]);
  const sheetHistory = useRef(new Map<string, { undo: BoardEdit[][]; redo: BoardEdit[][] }>());
  const clipboard = useRef<BoardObject[]>([]);
  const [copied, setCopied] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const textEditor = useRef<HTMLTextAreaElement | null>(null);
  const upload = useRef<HTMLInputElement | null>(null);
  const cursorSender = useRef<(point: Point) => void>(() => {});
  useEffect(() => {
    if (activeSheet !== sheetId) {
      setActiveSheet(sheetId);
      setSelected([]);
      undo.current = [];
      redo.current = [];
      sheetHistory.current.clear();
    }
  }, [activeSheet, sheetId]);
  function update(value: Board) {
    if (value.revision < current.current.revision) {
      return;
    }
    current.current = value;
    setBoard(value);
  }
  async function reload() {
    const fresh = await boardsApi<Board>(`/${initial.id}`);
    update(fresh);
    return fresh;
  }
  function report(reason: unknown) {
    setError(reason instanceof Error ? reason.message : 'Unable to update the whiteboard.');
  }

  useEffect(() => () => {
    if (moveTimer.current) {
      clearTimeout(moveTimer.current);
    }
  }, []);
  useEffect(() => {
    let stopped = false;
    const connection = new HubConnectionBuilder().withUrl(`${API_URL}/hubs/whiteboards`, { accessTokenFactory: () => getAccessToken() ?? '' }).withAutomaticReconnect().build();
    async function sync() {
      await connection.invoke('JoinBoard', initial.id);
      const fresh = await boardsApi<Board>(`/${initial.id}`);
      if (!stopped) {
        update(fresh);
        setOnline(true);
      }
    }
    connection.on('WhiteboardChanged', (change: BoardUpdate) => {
      if (change.boardId !== initial.id || stopped) {
        return;
      }
      if (change.revision > current.current.revision + 1 && !change.full) {
        void sync().catch(report);
      } else {
        update(mergeUpdate(current.current, change));
      }
    });
    connection.on('WhiteboardAccessChanged', (id: string) => {
      if (id === initial.id) {
        void sync().catch(reason => {
          report(reason);
          update({ ...current.current, objects: [], canEdit: false, isOwner: false });
          setOnline(false);
        });
      }
    });
    connection.on('WhiteboardCursor', (cursor: Cursor) => {
      if (cursor.boardId === initial.id && cursor.connectionId !== connection.connectionId) {
        setCursors(items => [...items.filter(x => x.connectionId !== cursor.connectionId), { ...cursor, seen: Date.now() }]);
      }
    });
    connection.on('WhiteboardCursorLeft', (id: string) => setCursors(items => items.filter(x => x.connectionId !== id)));
    connection.onreconnecting(() => setOnline(false));
    connection.onreconnected(() => { void sync().catch(report); });
    connection.onclose(() => setOnline(false));
    let lastCursor = 0;
    cursorSender.current = point => {
      if (connection.state === HubConnectionState.Connected && Date.now() - lastCursor > 80) {
        lastCursor = Date.now();
        void connection.invoke('Cursor', initial.id, point.x, point.y, activeSheetRef.current).catch(() => {});
      }
    };
    const timer = window.setInterval(() => {
      setCursors(items => items.filter(x => Date.now() - x.seen < 10000));
      if (connection.state === HubConnectionState.Disconnected) {
        void connection.start().then(sync).catch(() => setOnline(false));
      }
    }, 5000);
    void connection.start().then(sync).catch(reason => {
      if (!stopped) {
        report(reason);
      }
    });
    return () => {
      stopped = true;
      window.clearInterval(timer);
      cursorSender.current = () => {};
      void connection.stop();
    };
  }, [initial.id]);

  async function send(command: Pending) {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    setPending(command);
    try {
      const result = await boardsApi<BoardUpdate>(`/${board.id}/commands`, 'POST', { operationId: command.operationId, edits: command.edits, sheets: command.sheets, expectedRevision: command.expectedRevision });
      update(mergeUpdate(current.current, result));
      const inverse = command.before.map(object => ({ expectedVersion: result.objects.find(x => x.id === object.id)!.version, object }));
      if (command.mode === 'undo') {
        undo.current.pop();
        redo.current.push(inverse);
      } else if (command.mode === 'redo') {
        redo.current.pop();
        undo.current.push(inverse);
      } else {
        undo.current.push(inverse);
        redo.current = [];
      }
      if (command.mode !== 'edit') {
        const stack = command.mode === 'undo' ? undo.current : redo.current;
        for (const changed of result.objects) {
          const next = [...stack].reverse().flatMap(entry => entry.filter(edit => edit.object.id === changed.id))[0];
          if (next) {
            next.expectedVersion = changed.version;
          }
        }
      }
      if (result.full) {
        // A retried operation may already have been followed by another user's changes.
        undo.current = [];
        redo.current = [];
        sheetHistory.current.clear();
      }
      undo.current = undo.current.slice(-100);
      setPending(null);
    } catch (reason) {
      report(reason);
      if (reason instanceof BoardError && reason.status < 500) {
        setPending(null);
        await reload().catch(report);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function commit(objects: BoardObject[], mode: Pending['mode'] = 'edit', edits?: BoardEdit[]) {
    if (!current.current.canEdit || busyRef.current || pending) {
      return;
    }
    const top = Math.max(0, ...orderedObjects(current.current.objects).map(object => object.z!));
    objects = objects.map((object, index) => current.current.objects.some(existing => existing.id === object.id) ? object : { ...object, sheetId: activeSheetRef.current, z: top + index + 1 });
    const before = objects.map(object => current.current.objects.find(x => x.id === object.id) ?? { ...object, deleted: true });
    void send({ operationId: crypto.randomUUID(), edits: edits ?? objects.map(object => ({ expectedVersion: object.version, object })), before, mode });
  }
  function travel(mode: 'undo' | 'redo') {
    const edits = (mode === 'undo' ? undo : redo).current.at(-1);
    if (edits) {
      commit(edits.map(x => x.object), mode, edits);
    }
  }
  function flushMovement() {
    if (moveTimer.current) {
      clearTimeout(moveTimer.current);
      moveTimer.current = null;
    }
    heldArrows.current.clear();
    const change = movement.current;
    movement.current = null;
    setMoveDraft(null);
    if (change && current.current.canEdit && change.objects.some((object, index) => object.x !== change.before[index].x || object.y !== change.before[index].y)) {
      void send({ operationId: crypto.randomUUID(), edits: change.objects.map(object => ({ expectedVersion: object.version, object })), before: change.before, mode: 'edit' });
    }
  }
  useEffect(() => {
    const blur = () => {
      if (movement.current) {
        flushMovement();
      }
    };
    window.addEventListener('blur', blur);
    return () => window.removeEventListener('blur', blur);
  });
  const selectedItems = orderedObjects(sheetObjects).filter(object => selected.includes(object.id));
  const movableItems = selectedItems.filter(object => !object.locked);
  const item = selectedItems.length === 1 ? selectedItems[0] : undefined;
  const layers = orderedObjects(sheetObjects);
  const layerIndex = layers.findIndex(object => object.id === item?.id);
  function changeLayer(action: 'front' | 'back' | 'forward' | 'backward') {
    if (!item || layerIndex < 0) {
      return;
    }
    const remaining = layers.filter(object => object.id !== item.id);
    const position = action === 'front' ? remaining.length : action === 'back' ? 0 : action === 'forward' ? Math.min(layerIndex + 1, remaining.length) : Math.max(0, layerIndex - 1);
    const below = remaining[position - 1]?.z;
    const above = remaining[position]?.z;
    const z = below == null ? (above ?? 0) - 1 : above == null ? below + 1 : below + (above - below) / 2;
    if ((below != null && z <= below) || (above != null && z >= above) || Math.abs(z) > 1e12) {
      setError('These layers are too close together. Use Bring to front or Send to back instead.');
      return;
    }
    commit([{ ...item, z }]);
  }
  const disabled = !board.canEdit || busy || uploading || !!pending || !!moveDraft;
  const previewObjects = moveDraft ?? pending?.edits.map(edit => edit.object);
  const displayedBoard = previewObjects ? { ...board, objects: [...board.objects.filter(object => !previewObjects.some(preview => preview.id === object.id)), ...previewObjects] } : board;
  const sheetBoard = { ...displayedBoard, objects: displayedBoard.objects.filter(object => (object.sheetId ?? defaultSheetId) === sheetId) };
  function copyObjects() {
    const objects = orderedObjects(sheetBoard.objects).filter(object => selected.includes(object.id));
    if (objects.length > 0) {
      clipboard.current = objects;
      setCopied(true);
    }
  }
  function pasteObjects() {
    if (disabled || busyRef.current || clipboard.current.length === 0) {
      return;
    }
    const dx = Math.min(24, ...clipboard.current.map(object => 100000 - object.x));
    const dy = Math.min(24, ...clipboard.current.map(object => 100000 - object.y));
    const objects = clipboard.current.map(source => ({ ...source, id: crypto.randomUUID(), version: 0, x: source.x + dx, y: source.y + dy }));
    commit(objects);
    setSelected(objects.map(object => object.id));
    setTool('select');
    setPanel(null);
  }
  function selectSheet(id: string) {
    sheetHistory.current.set(sheetId, { undo: undo.current, redo: redo.current });
    const history = sheetHistory.current.get(id);
    undo.current = history?.undo ?? [];
    redo.current = history?.redo ?? [];
    setActiveSheet(id);
    setSelected([]);
    setPanel(null);
    setZoom(1);
  }
  async function saveSheets(next: BoardSheet[], activate?: string) {
    if (disabled) {
      return;
    }
    await send({ operationId: crypto.randomUUID(), edits: [], before: [], mode: 'edit', sheets: next, expectedRevision: current.current.revision });
    if (activate && current.current.sheets?.some(sheet => sheet.id === activate)) {
      selectSheet(activate);
    }
    setSelected([]);
  }
  async function addImage(file: File) {
    if (disabled) {
      return;
    }
    setUploading(true);
    try {
      if (file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
        throw new Error('Choose a PNG, JPEG, or WebP image up to 5 MB.');
      }
      const bitmap = await createImageBitmap(file);
      const width = Math.min(500, bitmap.width);
      const height = Math.max(1, width * bitmap.height / bitmap.width);
      bitmap.close();
      const data = new FormData();
      data.append('file', file);
      const result = await boardsApi<{ imageId: string }>(`/${board.id}/images`, 'POST', data);
      const object = { ...newObject('image', { x: 60, y: 60 }, color, fill, strokeWidth), width, height: Math.min(10000, height), imageId: result.imageId };
      commit([object]);
      setSelected([object.id]);
      setTool('select');
      window.dispatchEvent(new Event('documents-storage-changed'));
    } catch (reason) {
      report(reason);
    } finally {
      setUploading(false);
    }
  }
  async function openPanel(value: 'share' | 'history') {
    try {
      if (value === 'share') {
        setMembers(await boardsApi<Member[]>(`/${board.id}/members`));
      } else {
        setVersions(await boardsApi<Version[]>(`/${board.id}/versions`));
      }
      setPanel(panel === value ? null : value);
    } catch (reason) {
      report(reason);
    }
  }
  async function exportSvg() {
    try {
      const clone = svgRef.current!.cloneNode(true) as SVGSVGElement;
      clone.querySelectorAll('[data-selection], [data-cursor], [data-hit-target]').forEach(node => node.remove());
      clone.querySelector('g')?.removeAttribute('transform');
      const objects = sheetObjects.filter(x => !x.deleted);
      const x = Math.min(0, ...objects.map(o => o.x)) - 20;
      const y = Math.min(0, ...objects.map(o => o.y)) - 20;
      const width = Math.max(800, ...objects.map(o => o.x + o.width)) - x + 20;
      const height = Math.max(600, ...objects.map(o => o.y + o.height)) - y + 20;
      clone.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
      clone.setAttribute('width', String(width));
      clone.setAttribute('height', String(height));
      for (const image of clone.querySelectorAll('image')) {
        const blob = await (await fetch(image.getAttribute('href')!)).blob();
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        image.setAttribute('href', data);
      }
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${board.title.replace(/[^\w -]/g, '_')}-${sheets.find(sheet => sheet.id === sheetId)!.name.replace(/[^\w -]/g, '_')}.svg`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      report(reason);
    }
  }
  return <section className="whiteboard-workspace" onBlur={() => {
    if (movement.current) {
      flushMovement();
    }
  }} onKeyUp={event => {
    if (heldArrows.current.delete(event.key) && heldArrows.current.size === 0) {
      moveTimer.current = setTimeout(flushMovement, 300);
    }
  }} onKeyDown={event => {
    const target = event.target as Element;
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelected(sheetBoard.objects.filter(object => !object.deleted).map(object => object.id));
      setPanel(null);
      setTool('select');
    } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'c' && selectedItems.length > 0) {
      event.preventDefault();
      if (!event.repeat) {
        copyObjects();
      }
    } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'v' && clipboard.current.length > 0) {
      event.preventDefault();
      if (!event.repeat) {
        pasteObjects();
      }
    } else if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'z' || (event.key.toLowerCase() === 'y' && !event.shiftKey))) {
      event.preventDefault();
      if (!event.repeat && !disabled) {
        travel(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo');
      }
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (board.canEdit && !busyRef.current && !uploading && !pending && movableItems.length > 0) {
        if (moveTimer.current) {
          clearTimeout(moveTimer.current);
          moveTimer.current = null;
        }
        heldArrows.current.add(event.key);
        const objects = movement.current?.objects ?? movableItems;
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        // Clamp the group together so objects keep their relative positions at the board limits.
        const boundedX = Math.max(...objects.map(object => -100000 - object.x), Math.min(dx, ...objects.map(object => 100000 - object.x)));
        const boundedY = Math.max(...objects.map(object => -100000 - object.y), Math.min(dy, ...objects.map(object => 100000 - object.y)));
        if (boundedX !== 0 || boundedY !== 0) {
          const moved = objects.map(object => ({ ...object, x: object.x + boundedX, y: object.y + boundedY }));
          movement.current = { before: movement.current?.before ?? movableItems, objects: moved };
          setMoveDraft(moved);
        }
      }
    } else if (event.key === 'Delete' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      if (!event.repeat && !disabled && selectedItems.length > 0) {
        commit(selectedItems.map(object => ({ ...object, deleted: true })));
      }
    }
  }}>
    <header><button onClick={onBack} disabled={!!pending || busy || uploading || !!moveDraft}><ArrowLeft size={18} /> Boards</button><h2>{board.title}</h2><span role="status">{uploading ? 'Uploading…' : moveDraft ? 'Moving…' : busy ? 'Saving…' : pending ? 'Not saved' : `Saved · ${online ? 'Live' : 'Reconnecting…'}`}{!board.canEdit && ' · View only'}</span>
      {board.isOwner && <button onClick={async () => {
        const title = await promptDialog('Board title', board.title);
        if (title?.trim()) {
          void boardsApi(`/${board.id}`, 'PUT', { title }).then(reload).catch(report);
        }
      }}>Rename</button>}
      <button onClick={() => void exportSvg()}><Download size={16} /> Export SVG</button>
      <button type="button" onClick={() => setJsonSnapshot({ ...displayedBoard, sheets: pending?.sheets ?? sheets })}><Braces size={16} /> View JSON</button>
      <button onClick={() => void openPanel('history')}><History size={16} /> History</button>
      {board.isOwner && <button onClick={() => void openPanel('share')}><Share2 size={16} /> Share</button>}
    </header>
    <ToastNotice message={pending ? '' : error} />
    {error && pending && <div className="whiteboard-error" role="alert">{error}<button disabled={busy} onClick={() => void send(pending)}>Retry save</button><button disabled={busy} onClick={() => { setPending(null); void reload().catch(report); }}>Discard pending change</button></div>}
    <div className="whiteboard-toolbar" role="toolbar" aria-label="Whiteboard tools">
      {tools.map(([value, label, Icon]) => <button key={value} title={label} aria-label={label} aria-pressed={tool === value} disabled={disabled && value !== 'select' && value !== 'pan'} onClick={() => setTool(value)}><Icon size={19} /></button>)}
      <button title="Upload image" aria-label="Upload image" disabled={disabled} onClick={() => upload.current?.click()}><ImagePlus size={19} /></button>
      <input ref={upload} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) {
        void addImage(file);
      } event.target.value = ''; }} />
      <label>Color <input type="color" aria-label="Drawing color" value={color} onChange={e => setColor(e.target.value)} /></label>
      <label>Fill <input type="color" aria-label="Fill color" value={fill === 'transparent' ? '#ffffff' : fill} onChange={e => setFill(e.target.value)} /></label>
      <label><input type="checkbox" checked={fill === 'transparent'} onChange={e => setFill(e.target.checked ? 'transparent' : '#ffffff')} /> No fill</label>
      <label>Stroke <input type="number" aria-label="Stroke width" min="1" max="40" value={strokeWidth} onChange={e => setStrokeWidth(Math.max(1, Math.min(40, Number(e.target.value))))} /></label>
      <button aria-label="Undo" title="Undo (Ctrl/Command+Z)" disabled={disabled || !undo.current.length} onClick={() => travel('undo')}><Undo2 size={18} /></button>
      <button aria-label="Redo" title="Redo (Ctrl/Command+Shift+Z or Ctrl+Y)" disabled={disabled || !redo.current.length} onClick={() => travel('redo')}><Redo2 size={18} /></button>
      <button aria-label="Copy object" title="Copy selected objects (Ctrl/Command+C)" disabled={!selectedItems.length} onClick={copyObjects}><Copy size={18} /></button>
      <button aria-label="Paste object" title="Paste copied objects (Ctrl/Command+V)" disabled={disabled || !copied} onClick={pasteObjects}><ClipboardPaste size={18} /></button>
      <button aria-label="Delete object" title="Delete selected objects" disabled={disabled || !selectedItems.length} onClick={() => commit(selectedItems.map(object => ({ ...object, deleted: true })))}><Trash2 size={18} /></button>
      <button aria-label="Lock selected objects" title="Lock selected objects" disabled={disabled || !movableItems.length} onClick={() => commit(movableItems.map(object => ({ ...object, locked: true })))}><Lock size={18} /></button>
      <button aria-label="Unlock selected objects" title="Unlock selected objects" disabled={disabled || !selectedItems.some(object => object.locked)} onClick={() => commit(selectedItems.filter(object => object.locked).map(object => ({ ...object, locked: false })))}><LockOpen size={18} /></button>
      <button aria-label="Zoom out" onClick={() => setZoom(Math.max(.2, zoom / 1.2))}>−</button><button title="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button aria-label="Zoom in" onClick={() => setZoom(Math.min(4, zoom * 1.2))}>+</button>
    </div>
    <div className="whiteboard-body">
      <WhiteboardCanvas key={sheetId} board={sheetBoard} tool={tool} onToolChange={setTool} onEditText={id => {
        setSelected([id]);
        setPanel(null);
        requestAnimationFrame(() => textEditor.current?.focus());
      }} color={color} fill={fill} strokeWidth={strokeWidth} selected={selected.filter(id => displayedBoard.objects.some(object => object.id === id && !object.deleted))} onSelect={ids => {
        setSelected(ids);
        setPanel(null);
      }} onCommit={commit} disabled={disabled} onCursor={point => cursorSender.current(point)} cursors={cursors.filter(cursor => (cursor.sheetId ?? defaultSheetId) === sheetId)} onImage={file => void addImage(file)} zoom={zoom} setZoom={setZoom} svgRef={svgRef} />
      {(panel || selectedItems.length > 0) && <aside className="whiteboard-inspector">
        {!panel && selectedItems.length > 1 && <><h3>{selectedItems.length} objects selected</h3><p>Drag any selected object to move them together. Copy and delete apply to the entire selection.</p><p>Ctrl-click (Command-click on Mac) toggles individual objects. Click empty space to clear the selection.</p></>}
        {panel && <button onClick={() => setPanel(null)}>Close panel</button>}
        {panel === 'share' && <><h3>Share board</h3><p>Only invited accounts can open this board.</p><button onClick={() => void navigator.clipboard.writeText(`${location.origin}${location.pathname}?whiteboard=${board.id}`).then(() => { toast.success('Board link copied.'); }).catch(report)}>Copy board link</button>
          <form onSubmit={event => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void boardsApi(`/${board.id}/members`, 'POST', { username: data.get('username'), canEdit: data.get('role') === 'editor' }).then(async () => setMembers(await boardsApi<Member[]>(`/${board.id}/members`))).catch(report);
          }}><label>Username<input name="username" required /></label><label>Role<select name="role"><option value="editor">Editor</option><option value="viewer">Viewer</option></select></label><button type="submit">Grant access</button></form>
          {members.map(member => <div key={member.userId}><p>{member.username} · {member.canEdit ? 'Editor' : 'Viewer'}</p><button onClick={() => void boardsApi(`/${board.id}/members/${member.userId}`, 'DELETE').then(() => setMembers(items => items.filter(x => x.userId !== member.userId))).catch(report)}>Remove access</button></div>)}</>}
        {panel === 'history' && <><h3>Version history</h3><p>Latest 50 saved changes.</p>{versions.map(version => <div key={version.revision}><p>Revision {version.revision} · {new Date(version.createdAt).toLocaleString()}</p>{board.isOwner && <button disabled={disabled || version.revision === board.revision} onClick={async () => {
          if (await confirmDialog('Restore this version for everyone?')) {
            void boardsApi<Board>(`/${board.id}/versions/${version.revision}/restore`, 'POST', { expectedRevision: board.revision }).then(fresh => { undo.current = []; redo.current = []; update(fresh); setPanel(null); }).catch(report);
          }
        }}>Restore revision {version.revision}</button>}</div>)}</>}
        {!panel && item && <form key={`${item.id}-${item.version}`} onSubmit={event => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const width = Number(data.get('width'));
          const height = Number(data.get('height'));
          try {
            const positioned = item.kind === 'line'
              ? withLineEndpoints(item, { x: Number(data.get('startX')), y: Number(data.get('startY')) }, { x: Number(data.get('endX')), y: Number(data.get('endY')) })
              : { ...item, x: Number(data.get('x')), y: Number(data.get('y')), width, height, points: item.points.map(p => ({ x: p.x * width / item.width, y: p.y * height / item.height })) };
            commit([{ ...positioned, color: String(data.get('color')), fill: data.get('transparent') ? 'transparent' : String(data.get('fill')), text: String(data.get('text') ?? item.text), fontSize: Number(data.get('fontSize') ?? item.fontSize) }]);
          } catch (reason) {
            report(reason);
          }
        }}><h3>Object settings</h3>{item.locked && <p>Locked. Unlock this object in the toolbar to move or edit it.</p>}<fieldset disabled={disabled || item.locked}>
          <div role="group" aria-label="Object layer">
            <p>Layer order</p>
            <button type="button" disabled={layerIndex === layers.length - 1} onClick={() => changeLayer('front')}><BringToFront size={16} /> Bring to front</button>
            <button type="button" disabled={layerIndex === layers.length - 1} onClick={() => changeLayer('forward')}><ArrowUp size={16} /> Bring forward</button>
            <button type="button" disabled={layerIndex <= 0} onClick={() => changeLayer('backward')}><ArrowDown size={16} /> Send backward</button>
            <button type="button" disabled={layerIndex <= 0} onClick={() => changeLayer('back')}><SendToBack size={16} /> Send to back</button>
          </div>
          {item.kind === 'line' ? <>
            <p>Endpoint positions on the board</p>
            {(['start', 'end'] as const).map((endpoint, index) => <div key={endpoint} className="whiteboard-field-row" role="group" aria-label={`${endpoint === 'start' ? 'Start' : 'End'} position`}>
              <label>{endpoint === 'start' ? 'Start' : 'End'} Left<input name={`${endpoint}X`} type="number" step="any" min={-100000} max={100000} defaultValue={item.x + (item.points[index]?.x ?? 0)} required /></label>
              <label>{endpoint === 'start' ? 'Start' : 'End'} Top<input name={`${endpoint}Y`} type="number" step="any" min={-100000} max={100000} defaultValue={item.y + (item.points[index]?.y ?? 0)} required /></label>
            </div>)}
            <button type="button" onClick={() => commit([{ ...item, points: [...item.points].reverse() }])}><ArrowLeftRight size={16} /> Swap start/end</button>
          </> : <div className="whiteboard-field-row">
            {([['x', 'Left'], ['y', 'Top'], ['width', 'Width'], ['height', 'Height']] as const).map(([key, label]) => <label key={key}>{label}<input aria-label={`Object ${label.toLowerCase()}`} name={key} type="number" step="any" min={key === 'x' || key === 'y' ? -100000 : 1} max={key === 'x' || key === 'y' ? 100000 : 10000} defaultValue={item[key]} required /></label>)}
          </div>}
          <label>Color<input name="color" type="color" defaultValue={item.color} /></label><label>Fill<input name="fill" type="color" defaultValue={item.fill === 'transparent' ? '#ffffff' : item.fill} /></label><label><input name="transparent" type="checkbox" defaultChecked={item.fill === 'transparent'} /> No fill</label>
          {['text', 'sticky'].includes(item.kind) && <><label>Text<textarea ref={textEditor} name="text" defaultValue={item.text} maxLength={4000} /></label><label>Font size<input name="fontSize" type="number" min={8} max={200} defaultValue={item.fontSize} /></label></>}
          <button type="submit">Apply settings</button></fieldset></form>}
      </aside>}
    </div>
    <WhiteboardSheets sheets={sheets} activeId={sheetId} disabled={disabled} switchingDisabled={busy || uploading || !!pending || !!moveDraft} onSelect={selectSheet} onSave={saveSheets} />
    {jsonSnapshot && <WhiteboardJsonDialog board={jsonSnapshot} onClose={() => setJsonSnapshot(null)} />}
    <footer>Arrow keys move selection · Shift+Arrow moves 10 units · Ctrl/Command+A selects all · Delete removes selection</footer>
  </section>;
}
