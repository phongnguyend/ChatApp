import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Lock } from 'lucide-react';
import { API_URL, authFetch } from '../../services/auth';
import { newObject, orderedObjects, withLineEndpoints, type Board, type BoardObject, type Cursor, type Point } from './boardModel';

export type BoardTool = 'select' | 'pan' | 'eraser' | BoardObject['kind'];
type SelectionBox = { x: number; y: number; width: number; height: number };
function selectionBox(start: Point, end: Point): SelectionBox {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}
export function WhiteboardCanvas({ board, tool, onToolChange, onEditText, color, fill, strokeWidth, selected, onSelect, onCommit, disabled, onCursor, cursors, onImage, zoom, setZoom, svgRef }: {
  board: Board; tool: BoardTool; color: string; fill: string; strokeWidth: number; selected: string[];
  onToolChange: (tool: BoardTool) => void;
  onEditText: (id: string) => void;
  onSelect: (ids: string[]) => void; onCommit: (items: BoardObject[]) => void; disabled: boolean;
  onCursor: (point: Point) => void; cursors: Cursor[]; onImage: (file: File) => void;
  zoom: number; setZoom: (value: number) => void; svgRef: React.RefObject<SVGSVGElement | null>;
}) {
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [draft, setDraft] = useState<BoardObject | null>(null);
  const [marquee, setMarquee] = useState<SelectionBox | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const imageIds = [...new Set(board.objects.filter(x => !x.deleted && x.imageId).map(x => x.imageId!))].sort().join(',');
  useEffect(() => {
    let stopped = false;
    const urls: string[] = [];
    setImages({});
    for (const imageId of imageIds.split(',').filter(Boolean)) {
      void authFetch(`${API_URL}/api/whiteboards/${board.id}/images/${imageId}`).then(async response => {
        if (!response.ok) {
          return;
        }
        const url = URL.createObjectURL(await response.blob());
        if (stopped) {
          URL.revokeObjectURL(url);
          return;
        }
        urls.push(url);
        setImages(current => ({ ...current, [imageId]: url }));
      }).catch(() => {});
    }
    return () => {
      stopped = true;
      urls.forEach(URL.revokeObjectURL);
    };
  }, [board.id, imageIds]);
  const gesture = useRef<{ start: Point; screen: Point; original?: BoardObject; originals?: BoardObject[]; baseSelection?: string[]; endpoint?: number; mode: 'draw' | 'move' | 'resize' | 'endpoint' | 'pan' | 'place' | 'marquee'; pan: Point } | null>(null);
  const draftRef = useRef<BoardObject | null>(null);
  useEffect(() => {
    const svg = svgRef.current;
    const preventPageScroll = (event: WheelEvent) => event.preventDefault();
    svg?.addEventListener('wheel', preventPageScroll, { passive: false });
    return () => svg?.removeEventListener('wheel', preventPageScroll);
  }, [svgRef]);
  function preview(item: BoardObject | null) {
    draftRef.current = item;
    setDraft(item);
  }
  function point(event: { clientX: number; clientY: number }): Point {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left - pan.x) / zoom, y: (event.clientY - rect.top - pan.y) / zoom };
  }
  function down(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    event.currentTarget.focus();
    const start = point(event);
    const target = event.target as Element;
    const id = target.closest('[data-object-id]')?.getAttribute('data-object-id');
    const item = board.objects.find(x => x.id === id && !x.deleted);
    if (tool === 'pan' || event.button === 1) {
      gesture.current = { start, screen: { x: event.clientX, y: event.clientY }, pan, mode: 'pan' };
    } else if (tool === 'select') {
      if (!item) {
        gesture.current = { start, screen: { x: event.clientX, y: event.clientY }, pan, mode: 'marquee', baseSelection: event.ctrlKey || event.metaKey ? [...selected] : [] };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (item) {
          onSelect(selected.includes(item.id) ? selected.filter(id => id !== item.id) : [...selected, item.id]);
        }
        return;
      }
      const ids = item ? selected.includes(item.id) ? selected : [item.id] : [];
      onSelect(ids);
      if (item && !disabled && !item.locked) {
        gesture.current = { start, screen: start, pan, original: item, originals: board.objects.filter(object => ids.includes(object.id) && !object.deleted && !object.locked), mode: target.getAttribute('data-resize') && ids.length === 1 ? 'resize' : 'move' };
        if (item.kind === 'line' && ids.length === 1 && target.hasAttribute('data-endpoint')) {
          gesture.current.mode = 'endpoint';
          gesture.current.endpoint = Number(target.getAttribute('data-endpoint'));
        }
        preview(item);
      }
    } else if (!disabled && tool === 'eraser') {
      if (item) {
        onCommit([{ ...item, deleted: true }]);
      }
    } else if (!disabled && tool !== 'image' && tool !== 'eraser') {
      const item = newObject(tool, start, color, fill, strokeWidth);
      if (tool === 'text' || tool === 'sticky') {
        gesture.current = { start, screen: start, pan, original: item, mode: 'place' };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      item.width = tool === 'line' ? 160 : 1;
      item.height = 1;
      // A click without dragging must still create a valid two-endpoint line.
      item.points = tool === 'line' ? [{ x: 0, y: 0 }, { x: item.width, y: 0 }] : [{ x: 0, y: 0 }];
      gesture.current = { start, screen: start, pan, original: item, mode: 'draw' };
      preview(item);
      onSelect([item.id]);
    }
    if (gesture.current) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const current = point(event);
    onCursor(current);
    const active = gesture.current;
    if (!active) {
      return;
    }
    if (active.mode === 'place') {
      return;
    }
    if (active.mode === 'marquee') {
      if (Math.hypot(event.clientX - active.screen.x, event.clientY - active.screen.y) >= 4) {
        setMarquee(selectionBox(active.start, current));
      } else {
        setMarquee(null);
      }
      return;
    }
    if (active.mode === 'pan') {
      setPan({ x: active.pan.x + event.clientX - active.screen.x, y: active.pan.y + event.clientY - active.screen.y });
      return;
    }
    const original = active.original!;
    const dx = current.x - active.start.x;
    const dy = current.y - active.start.y;
    if (active.mode === 'move') {
      preview({ ...original, x: original.x + dx, y: original.y + dy });
    } else if (active.mode === 'endpoint') {
      const endpoints = original.points.map(p => ({ x: original.x + p.x, y: original.y + p.y }));
      const index = active.endpoint!;
      const fixed = endpoints[1 - index];
      endpoints[index] = {
        x: Math.max(-100000, fixed.x - 10000, Math.min(100000, fixed.x + 10000, endpoints[index].x + dx)),
        y: Math.max(-100000, fixed.y - 10000, Math.min(100000, fixed.y + 10000, endpoints[index].y + dy)),
      };
      preview(withLineEndpoints(original, endpoints[0], endpoints[1]));
    } else if (active.mode === 'resize') {
      const width = Math.max(1, Math.min(10000, original.width + dx));
      const height = Math.max(1, Math.min(10000, original.height + dy));
      preview({ ...original, width, height, points: original.points.map(p => ({ x: p.x * width / original.width, y: p.y * height / original.height })) });
    } else if (original.kind === 'path') {
      const prior = draftRef.current!;
      const points = prior.points.length < 4000 ? [...prior.points, { x: dx, y: dy }] : prior.points;
      preview({ ...prior, points, width: Math.max(1, ...points.map(p => Math.abs(p.x))), height: Math.max(1, ...points.map(p => Math.abs(p.y))) });
    } else {
      preview({ ...original, x: Math.min(active.start.x, current.x), y: Math.min(active.start.y, current.y), width: Math.max(1, Math.abs(dx)), height: Math.max(1, Math.abs(dy)), points: original.kind === 'line' ? [{ x: dx < 0 ? Math.abs(dx) : 0, y: dy < 0 ? Math.abs(dy) : 0 }, { x: dx < 0 ? 0 : dx, y: dy < 0 ? 0 : dy }] : [] });
    }
  }
  function finish(event: PointerEvent<SVGSVGElement>, cancel = false) {
    if (gesture.current?.mode === 'marquee') {
      const active = gesture.current;
      if (!cancel) {
        const dragged = Math.hypot(event.clientX - active.screen.x, event.clientY - active.screen.y) >= 4;
        onSelect(dragged ? objectsInBox(selectionBox(active.start, point(event)), active.baseSelection ?? []) : active.baseSelection ?? []);
      }
      gesture.current = null;
      setMarquee(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (gesture.current?.mode === 'place') {
      const item = gesture.current.original!;
      // Text placement is one-shot; content can be configured in Object settings later.
      gesture.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onToolChange('select');
      if (!cancel && !disabled) {
        onCommit([{ ...item, text: item.kind === 'sticky' ? 'Sticky note' : 'Text', width: item.kind === 'sticky' ? 220 : 300, height: 160 }]);
        onSelect([item.id]);
      }
      return;
    }
    if (gesture.current && gesture.current.mode !== 'pan' && draftRef.current && !cancel) {
      const item = draftRef.current;
      if (gesture.current.mode === 'draw') {
        onToolChange('select');
      }
      // Normalize freehand bounds so selection and resize handles cover the whole stroke.
      if (item.kind === 'path' && gesture.current.mode === 'draw') {
        const minX = Math.min(...item.points.map(p => p.x));
        const minY = Math.min(...item.points.map(p => p.y));
        onCommit([{ ...item, x: item.x + minX, y: item.y + minY, width: Math.max(1, ...item.points.map(p => p.x - minX)), height: Math.max(1, ...item.points.map(p => p.y - minY)), points: item.points.map(p => ({ x: p.x - minX, y: p.y - minY })) }]);
      } else {
        if (gesture.current.mode === 'draw' || JSON.stringify(item) !== JSON.stringify(gesture.current.original)) {
          if (gesture.current.mode === 'move' && gesture.current.originals) {
            const origin = gesture.current.original!;
            onCommit(gesture.current.originals.map(object => ({ ...object, x: object.x + item.x - origin.x, y: object.y + item.y - origin.y })));
          } else {
            onCommit([item]);
          }
        }
      }
    }
    gesture.current = null;
    preview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }
  const objects = orderedObjects(board.objects).map(item => {
    const active = gesture.current;
    const original = active?.mode === 'move' ? active.originals?.find(object => object.id === item.id) : undefined;
    if (draft && original && active?.original) {
      return { ...original, x: original.x + draft.x - active.original.x, y: original.y + draft.y - active.original.y };
    }
    return draft?.id === item.id ? draft : item;
  });
  if (draft && !objects.some(item => item.id === draft.id)) {
    objects.push(draft);
  }
  function objectsInBox(box: SelectionBox, base: string[]): string[] {
    const hits = board.objects.filter(item => !item.deleted && item.x <= box.x + box.width && item.x + item.width >= box.x && item.y <= box.y + box.height && item.y + item.height >= box.y);
    return [...new Set([...base, ...hits.map(item => item.id)])];
  }
  const highlighted = marquee ? objectsInBox(marquee, gesture.current?.baseSelection ?? []) : selected;
  return <div className="whiteboard-stage" onDragOver={event => event.preventDefault()} onDrop={event => {
    event.preventDefault();
    if (!disabled && event.dataTransfer.files[0]) {
      onImage(event.dataTransfer.files[0]);
    }
  }} onPaste={event => {
    const file = event.clipboardData.files[0];
    if (!disabled && file) {
      event.preventDefault();
      onImage(file);
    }
  }}>
    <svg ref={svgRef} role="application" aria-label="Whiteboard canvas" tabIndex={0} className={`whiteboard-svg tool-${tool}`} onPointerDown={down} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onWheel={event => {
      if (event.ctrlKey || event.metaKey) {
        setZoom(Math.max(.2, Math.min(4, zoom * (event.deltaY > 0 ? .9 : 1.1))));
      } else {
        setPan(current => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
      }
    }} onDoubleClick={event => {
      if (disabled) {
        return;
      }
      // Pointer capture can retarget the double-click to the SVG rather than the object.
      const target = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY);
      const id = target?.closest('[data-object-id]')?.getAttribute('data-object-id');
      const item = board.objects.find(x => x.id === id);
      if (item && ['text', 'sticky'].includes(item.kind)) {
        onEditText(item.id);
      }
    }}>
      <defs><pattern id="board-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#cbd5e1" /></pattern></defs>
      <rect width="100%" height="100%" fill="url(#board-grid)" />
      <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
        {objects.map(item => <g key={item.id} data-object-id={item.id} transform={`translate(${item.x} ${item.y})`} style={{ cursor: tool === 'select' ? !disabled && !item.locked ? 'move' : 'default' : undefined }}>
          {item.kind === 'path' && <rect data-hit-target="true" x={-6 / zoom} y={-6 / zoom} width={item.width + 12 / zoom} height={item.height + 12 / zoom} fill="transparent" pointerEvents={tool === 'select' ? 'all' : 'none'} />}
          {item.kind === 'rectangle' && <rect width={item.width} height={item.height} fill={item.fill} stroke={item.color} strokeWidth={item.strokeWidth} />}
          {item.kind === 'ellipse' && <ellipse cx={item.width / 2} cy={item.height / 2} rx={item.width / 2} ry={item.height / 2} fill={item.fill} stroke={item.color} strokeWidth={item.strokeWidth} />}
          {(item.kind === 'path' || item.kind === 'line') && <>
            <polyline data-hit-target="true" points={item.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="transparent" strokeWidth={Math.max(item.strokeWidth, 24 / zoom)} strokeLinecap="round" strokeLinejoin="round" pointerEvents={tool === 'select' || tool === 'eraser' ? 'stroke' : 'none'} />
            <polyline points={item.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={item.color} strokeWidth={item.strokeWidth} strokeLinecap="round" strokeLinejoin="round" pointerEvents="stroke" />
          </>}
          {item.kind === 'path' && item.points.length === 1 && <circle data-hit-target="true" cx={item.points[0].x} cy={item.points[0].y} r={Math.max(item.strokeWidth / 2, 12 / zoom)} fill="transparent" pointerEvents={tool === 'select' || tool === 'eraser' ? 'all' : 'none'} />}
          {item.kind === 'path' && item.points.length === 1 && <circle cx={item.points[0].x} cy={item.points[0].y} r={item.strokeWidth / 2} fill={item.color} />}
          {item.kind === 'image' && (images[item.imageId!] ? <image href={images[item.imageId!]} width={item.width} height={item.height} preserveAspectRatio="xMidYMid meet" /> : <><rect width={item.width} height={item.height} fill="#e2e8f0" /><text x="8" y="24">Image unavailable</text></>)}
          {(item.kind === 'text' || item.kind === 'sticky') && <>
            <rect width={item.width} height={item.height} rx={item.kind === 'sticky' ? 6 : 0} fill={item.kind === 'sticky' ? item.fill : 'transparent'} />
            <text fill={item.color} fontSize={item.fontSize} fontFamily="system-ui, sans-serif">{item.text.split('\n').flatMap(line => line.match(new RegExp(`.{1,${Math.max(1, Math.floor((item.width - 20) / (item.fontSize * .6)))}}`, 'g')) ?? ['']).map((line, index) => <tspan key={index} x="10" y={item.fontSize + 10 + index * item.fontSize * 1.3}>{line}</tspan>)}</text>
          </>}
          {highlighted.includes(item.id) && <g data-selection="true">
            <rect x="-4" y="-4" width={item.width + 8} height={item.height + 8} fill="none" stroke={item.locked ? '#d97706' : '#0284c7'} strokeWidth={(item.locked ? 2 : 1) / zoom} strokeDasharray={item.locked ? undefined : `${4 / zoom}`} pointerEvents="none" />
            {item.locked && <g role="img" aria-label="Locked object" transform={`translate(${item.width - 20 / zoom} 0) scale(${1 / zoom})`} pointerEvents="none">
              <title>Locked object</title>
              <rect width="24" height="24" rx="5" fill="#fffbeb" stroke="#d97706" />
              <Lock x={4} y={4} width={16} height={16} color="#92400e" />
            </g>}
            {!disabled && !item.locked && !marquee && selected.length === 1 && (item.kind === 'line'
              ? item.points.map((p, index) => <circle key={index} data-endpoint={index} aria-label={`${index === 0 ? 'Start' : 'End'} endpoint`} cx={p.x} cy={p.y} r={6 / zoom} fill={index === 0 ? '#16a34a' : '#dc2626'} stroke="white" strokeWidth={1 / zoom} style={{ cursor: 'crosshair' }}><title>{index === 0 ? 'Start point' : 'End point'}</title></circle>)
              : <rect data-resize="true" x={item.width - 5 / zoom} y={item.height - 5 / zoom} width={10 / zoom} height={10 / zoom} fill="#0284c7" />)}
          </g>}
        </g>)}
        {marquee && <rect data-marquee="true" data-selection="true" {...marquee} fill="rgba(2,132,199,0.1)" stroke="#0284c7" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom}`} pointerEvents="none" />}
        {cursors.map(cursor => <g key={cursor.connectionId} transform={`translate(${cursor.x} ${cursor.y})`} pointerEvents="none" data-cursor="true"><path d="M0 0 L0 18 L5 13 L11 21 L14 19 L8 11 L16 10 Z" fill="#c026d3" /><text x="18" y="20" fill="#86198f" fontSize={12 / zoom}>{cursor.name}</text></g>)}
      </g>
    </svg>
  </div>;
}
