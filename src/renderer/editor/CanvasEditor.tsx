import { CanvasTextMetrics, TextStyle } from 'pixi.js';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  getCurrentSlide,
  sealHistory,
  setSelection,
  updateElements,
  useDeckStore,
  type SlideElement,
  type TextElement,
} from '../deck';
import { midi } from '../midi';
import { getDeckResources } from '../render';
import { EditorCanvas, setActiveCanvas } from './editorCanvas';
import {
  boundsOf,
  centreOf,
  handlePoint,
  HANDLES,
  hitTest,
  rectFromPoints,
  rectsIntersect,
  resizeBox,
  rotationFor,
  snapMove,
  snapTargets,
  unionBounds,
  type Box,
  type Handle,
  type Point,
  type Rect,
  type SnapTargets,
} from './geometry';
import { useEditorUi } from './uiStore';

type Gesture =
  | {
      kind: 'move';
      start: Point;
      origin: Map<string, Point>;
      bounds: Rect;
      targets: SnapTargets;
      key: string;
      moved: boolean;
    }
  | { kind: 'resize'; id: string; handle: Handle; start: Box; keepAspect: boolean; key: string }
  | { kind: 'rotate'; id: string; centre: Point; key: string }
  | { kind: 'marquee'; start: Point; additive: string[] };

let gestureCounter = 0;
const GESTURE = { coalesceWindowMs: Infinity } as const;

function measuredTextHeight(el: TextElement, text: string): number {
  try {
    const style = new TextStyle({
      fontFamily: el.fontFamily,
      fontSize: el.fontSize,
      fontWeight: String(el.fontWeight) as '400',
      lineHeight: el.fontSize * el.lineHeight,
      wordWrap: true,
      wordWrapWidth: el.width,
    });
    return Math.ceil(CanvasTextMetrics.measureText(text || ' ', style).height);
  } catch {
    return el.height;
  }
}

/** The slide canvas: live Pixi rendering underneath, selection and handles drawn on top. */
export function CanvasEditor() {
  const deck = useDeckStore((s) => s.deck);
  const path = useDeckStore((s) => s.path);
  const slide = useDeckStore((s) => getCurrentSlide(s));
  const selection = useDeckStore((s) => s.selection);
  const fpsVisible = useEditorUi((s) => s.fpsVisible);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fpsRef = useRef<HTMLDivElement>(null);
  const controller = useRef<EditorCanvas | null>(null);
  const gesture = useRef<Gesture | null>(null);

  const [view, setView] = useState({ width: 0, height: 0 });
  const [guides, setGuides] = useState<{ vertical: number[]; horizontal: number[] }>({
    vertical: [],
    horizontal: [],
  });
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const slideWidth = deck?.meta.canvas.width ?? 1920;
  const slideHeight = deck?.meta.canvas.height ?? 1080;
  const scale = view.width > 0 ? view.width / slideWidth : 1;

  // Fit the canvas into the available space, keeping the slide's aspect ratio.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fit = (): void => {
      const availW = Math.max(100, wrap.clientWidth - 48);
      const availH = Math.max(100, wrap.clientHeight - 48);
      const s = Math.min(availW / slideWidth, availH / slideHeight);
      const next = { width: Math.floor(slideWidth * s), height: Math.floor(slideHeight * s) };
      setView((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [slideWidth, slideHeight]);

  // Create the Pixi canvas for this deck and keep it in step with the store.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !path) return;
    const size = { width: slideWidth, height: slideHeight };
    const instance = new EditorCanvas(
      canvas,
      size,
      getDeckResources(path).textures,
      midi.bus,
      midi.input,
    );
    controller.current = instance;
    let unsubscribe: (() => void) | null = null;

    const push = (): void => {
      const state = useDeckStore.getState();
      const current = getCurrentSlide(state);
      if (state.deck && current) instance.show(current, state.deck);
    };
    void instance.init().then((ready) => {
      if (!ready) return;
      setActiveCanvas(instance);
      instance.meter.attach(fpsRef.current);
      const rect = canvas.getBoundingClientRect();
      instance.resize(rect.width, window.devicePixelRatio || 1);
      push();
      unsubscribe = useDeckStore.subscribe(push);
    });
    return () => {
      unsubscribe?.();
      setActiveCanvas(null);
      controller.current = null;
      instance.destroy();
    };
  }, [path, slideWidth, slideHeight]);

  useEffect(() => {
    if (view.width > 0) controller.current?.resize(view.width, window.devicePixelRatio || 1);
  }, [view.width]);

  useEffect(() => {
    controller.current?.setEditing(editingId);
  }, [editingId]);

  // Leaving the slide ends any text edit.
  useEffect(() => setEditingId(null), [slide?.id]);

  const toSlide = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return { x: 0, y: 0 };
      return {
        x: ((e.clientX - rect.left) / rect.width) * slideWidth,
        y: ((e.clientY - rect.top) / rect.height) * slideHeight,
      };
    },
    [slideWidth, slideHeight],
  );

  const topmostAt = (p: Point): SlideElement | undefined =>
    slide?.elements.findLast((el) => !el.hidden && !el.locked && hitTest(el, p, 14 / scale));

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!slide || !deck || e.button !== 0 || editingId) return;
    const p = toSlide(e);
    const key = `gesture:${++gestureCounter}`;
    const handle = (e.target as Element).getAttribute('data-handle');
    const single =
      selection.length === 1 ? slide.elements.find((el) => el.id === selection[0]) : undefined;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (handle && single && !single.locked) {
      gesture.current =
        handle === 'rotate'
          ? { kind: 'rotate', id: single.id, centre: centreOf(single), key }
          : {
              kind: 'resize',
              id: single.id,
              handle: handle as Handle,
              start: {
                x: single.x,
                y: single.y,
                width: single.width,
                height: single.height,
                rotation: single.rotation,
              },
              keepAspect: single.type === 'image',
              key,
            };
      return;
    }

    const hit = topmostAt(p);
    if (!hit) {
      if (!e.shiftKey) setSelection([]);
      gesture.current = { kind: 'marquee', start: p, additive: e.shiftKey ? selection : [] };
      return;
    }
    let next = selection;
    if (e.shiftKey) {
      next = selection.includes(hit.id)
        ? selection.filter((id) => id !== hit.id)
        : [...selection, hit.id];
    } else if (!selection.includes(hit.id)) {
      next = [hit.id];
    }
    setSelection(next);
    if (!next.includes(hit.id)) return;

    const moving = slide.elements.filter((el) => next.includes(el.id) && !el.locked);
    const others = slide.elements.filter((el) => !next.includes(el.id) && !el.hidden);
    const bounds = unionBounds(moving);
    if (!bounds) return;
    gesture.current = {
      kind: 'move',
      start: p,
      origin: new Map(moving.map((el) => [el.id, { x: el.x, y: el.y }])),
      bounds,
      targets: snapTargets(deck.meta.canvas, others),
      key,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const g = gesture.current;
    if (!g) return;
    const p = toSlide(e);

    if (g.kind === 'move') {
      let dx = p.x - g.start.x;
      let dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) < 3 / scale) return;
      g.moved = true;
      if (e.altKey) {
        setGuides({ vertical: [], horizontal: [] });
      } else {
        const moved: Rect = {
          left: g.bounds.left + dx,
          right: g.bounds.right + dx,
          top: g.bounds.top + dy,
          bottom: g.bounds.bottom + dy,
        };
        const snap = snapMove(moved, g.targets, 6 / scale);
        dx += snap.dx;
        dy += snap.dy;
        setGuides(snap.guides);
      }
      updateElements(
        [...g.origin.keys()],
        (el) => {
          const o = g.origin.get(el.id);
          if (!o) return;
          el.x = Math.round(o.x + dx);
          el.y = Math.round(o.y + dy);
        },
        { label: 'Move', coalesceKey: g.key, ...GESTURE },
      );
    } else if (g.kind === 'resize') {
      const next = resizeBox(g.start, g.handle, p, {
        keepAspect: g.keepAspect || e.shiftKey,
        minSize: 8,
      });
      updateElements(
        [g.id],
        (el) => {
          el.x = Math.round(next.x);
          el.y = Math.round(next.y);
          el.width = Math.max(1, Math.round(next.width));
          el.height = Math.max(1, Math.round(next.height));
        },
        { label: 'Resize', coalesceKey: g.key, ...GESTURE },
      );
    } else if (g.kind === 'rotate') {
      const deg = rotationFor(g.centre, p, e.shiftKey);
      updateElements(
        [g.id],
        (el) => {
          el.rotation = Math.round(deg * 10) / 10;
        },
        { label: 'Rotate', coalesceKey: g.key, ...GESTURE },
      );
    } else {
      setMarquee(rectFromPoints(g.start, p));
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>): void => {
    const g = gesture.current;
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (!g) return;
    if (g.kind === 'marquee' && slide) {
      const rect = rectFromPoints(g.start, toSlide(e));
      if (rect.right - rect.left > 2 || rect.bottom - rect.top > 2) {
        const inside = slide.elements
          .filter((el) => !el.hidden && !el.locked && rectsIntersect(rect, boundsOf(el)))
          .map((el) => el.id);
        setSelection([...new Set([...g.additive, ...inside])]);
      }
      setMarquee(null);
    }
    setGuides({ vertical: [], horizontal: [] });
    sealHistory();
  };

  const onDoubleClick = (e: React.MouseEvent): void => {
    const hit = topmostAt(toSlide(e));
    if (hit?.type === 'text') {
      setSelection([hit.id]);
      setEditingId(hit.id);
    }
  };

  const editing = editingId ? slide?.elements.find((el) => el.id === editingId) : undefined;
  const commitText = (text: string): void => {
    if (editing?.type === 'text' && text !== editing.text) {
      const height = Math.max(editing.height, measuredTextHeight(editing, text));
      updateElements(
        [editing.id],
        (el) => {
          if (el.type !== 'text') return;
          el.text = text;
          el.height = height;
        },
        { label: 'Edit text' },
      );
    }
    setEditingId(null);
  };

  const selected = slide?.elements.filter((el) => selection.includes(el.id)) ?? [];
  const handleSize = 10 / scale;
  const strokeWidth = 1.5 / scale;

  return (
    <div className="canvas-wrap" ref={wrapRef} data-testid="canvas-wrap">
      <div className="canvas-frame" style={{ width: view.width, height: view.height }}>
        {/* Keyed by deck path: a destroyed WebGL context cannot be reused, so each renderer gets a fresh canvas. */}
        <canvas
          key={path ?? 'none'}
          ref={canvasRef}
          className="slide-canvas"
          data-testid="slide-canvas"
        />
        <svg
          className="canvas-overlay"
          data-testid="canvas-overlay"
          viewBox={`0 0 ${slideWidth} ${slideHeight}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          {selected.map((el) => {
            const c = centreOf(el);
            const showHandles = selected.length === 1 && !el.locked && !editingId;
            const top = handlePoint({ ...el, rotation: 0 }, 'n');
            return (
              <g key={el.id} transform={`rotate(${el.rotation} ${c.x} ${c.y})`}>
                <rect
                  className={el.locked ? 'sel-outline locked' : 'sel-outline'}
                  x={el.x}
                  y={el.y}
                  width={el.width}
                  height={el.height}
                  strokeWidth={strokeWidth}
                />
                {showHandles && (
                  <>
                    <line
                      className="sel-stem"
                      x1={top.x}
                      y1={top.y}
                      x2={top.x}
                      y2={top.y - 28 / scale}
                      strokeWidth={strokeWidth}
                    />
                    <circle
                      className="sel-handle rotate"
                      data-handle="rotate"
                      cx={top.x}
                      cy={top.y - 28 / scale}
                      r={handleSize * 0.6}
                      strokeWidth={strokeWidth}
                    />
                    {HANDLES.map((h) => {
                      const hp = handlePoint({ ...el, rotation: 0 }, h);
                      return (
                        <rect
                          key={h}
                          className={`sel-handle h-${h}`}
                          data-handle={h}
                          x={hp.x - handleSize / 2}
                          y={hp.y - handleSize / 2}
                          width={handleSize}
                          height={handleSize}
                          strokeWidth={strokeWidth}
                        />
                      );
                    })}
                  </>
                )}
              </g>
            );
          })}
          {guides.vertical.map((x) => (
            <line
              key={`v${x}`}
              className="guide"
              x1={x}
              y1={0}
              x2={x}
              y2={slideHeight}
              strokeWidth={strokeWidth}
            />
          ))}
          {guides.horizontal.map((y) => (
            <line
              key={`h${y}`}
              className="guide"
              x1={0}
              y1={y}
              x2={slideWidth}
              y2={y}
              strokeWidth={strokeWidth}
            />
          ))}
          {marquee && (
            <rect
              className="marquee"
              x={marquee.left}
              y={marquee.top}
              width={marquee.right - marquee.left}
              height={marquee.bottom - marquee.top}
              strokeWidth={strokeWidth}
            />
          )}
        </svg>
        {editing?.type === 'text' && (
          <textarea
            className="text-editor"
            data-testid="text-editor"
            autoFocus
            defaultValue={editing.text}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => commitText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
                e.preventDefault();
                e.currentTarget.blur();
              }
              e.stopPropagation();
            }}
            style={{
              left: editing.x * scale,
              top: editing.y * scale,
              width: editing.width * scale,
              height: editing.height * scale,
              transform: `rotate(${editing.rotation}deg)`,
              fontFamily: `"${editing.fontFamily}"`,
              fontSize: editing.fontSize * scale,
              fontWeight: editing.fontWeight,
              color: editing.color,
              textAlign: editing.align,
              lineHeight: editing.lineHeight,
            }}
          />
        )}
        <div className="fps-overlay" ref={fpsRef} hidden={!fpsVisible} data-testid="fps-overlay" />
      </div>
    </div>
  );
}
