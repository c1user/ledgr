import { useCallback, useEffect, useRef, useState } from "react";
import cx from "@abaco/ui/cx";

// Pinch-zoom + pan viewer for the receipt image. Pointer events unify touch
// and mouse: two pointers pinch, one pointer pans while zoomed, a double-tap
// (or double-click) toggles 2× ↔ reset, and the mouse wheel zooms on desktop.
// At scale 1 the box passes vertical touches through (`pan-y`) so the page
// still scrolls; while zoomed it owns every touch.
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const TAP_ZOOM = 2;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 24;
const TAP_SLOP_PX = 6;
const WHEEL_SENSITIVITY = 0.0015;

const RESET = { scale: 1, tx: 0, ty: 0 };

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function clampView({ scale, tx, ty }, rect) {
  const s = clamp(scale, MIN_SCALE, MAX_SCALE);
  const maxX = ((s - 1) * rect.width) / 2;
  const maxY = ((s - 1) * rect.height) / 2;
  return { scale: s, tx: clamp(tx, -maxX, maxX), ty: clamp(ty, -maxY, maxY) };
}

export default function ZoomableImage({
  src,
  alt,
  hint,
  onLoad,
  onError,
  className,
}) {
  const boxRef = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const viewRef = useRef(RESET);
  const [view, setView] = useState(RESET);
  const [dragging, setDragging] = useState(false);

  const apply = useCallback((next) => {
    viewRef.current = next;
    setView(next);
  }, []);

  // NOTE: a new image should start unzoomed — parents remount the viewer
  // with key={src} instead of this component syncing state in an effect.

  const toggleZoom = useCallback(
    (clientX, clientY) => {
      const box = boxRef.current;
      if (!box) return;
      const v = viewRef.current;
      if (v.scale > MIN_SCALE) {
        apply(RESET);
        return;
      }
      const rect = box.getBoundingClientRect();
      // Zoom towards the tapped point.
      const cx0 = clientX - rect.left - rect.width / 2;
      const cy0 = clientY - rect.top - rect.height / 2;
      apply(
        clampView(
          {
            scale: TAP_ZOOM,
            tx: -cx0 * (TAP_ZOOM - 1),
            ty: -cy0 * (TAP_ZOOM - 1),
          },
          rect,
        ),
      );
    },
    [apply],
  );

  // React registers wheel listeners as passive; a native one can
  // preventDefault so zooming does not also scroll the page.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = box.getBoundingClientRect();
      const v = viewRef.current;
      const factor = Math.exp(-e.deltaY * WHEEL_SENSITIVITY);
      apply(clampView({ ...v, scale: v.scale * factor }, rect));
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [apply]);

  const onPointerDown = (e) => {
    const box = boxRef.current;
    if (!box) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try {
      box.setPointerCapture(e.pointerId);
    } catch {
      /* best-effort */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const v = viewRef.current;
    if (pts.length === 2) {
      gesture.current = {
        type: "pinch",
        startDist: dist(pts[0], pts[1]) || 1,
        startMid: mid(pts[0], pts[1]),
        startScale: v.scale,
        startTx: v.tx,
        startTy: v.ty,
      };
    } else if (pts.length === 1) {
      gesture.current = {
        type: "pan",
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
      };
    }
    setDragging(true);
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const box = boxRef.current;
    if (!g || !box) return;
    const rect = box.getBoundingClientRect();
    const pts = [...pointers.current.values()];

    if (g.type === "pinch" && pts.length >= 2) {
      const d = dist(pts[0], pts[1]);
      const m = mid(pts[0], pts[1]);
      apply(
        clampView(
          {
            scale: g.startScale * (d / g.startDist),
            tx: g.startTx + (m.x - g.startMid.x),
            ty: g.startTy + (m.y - g.startMid.y),
          },
          rect,
        ),
      );
      return;
    }

    if (g.type === "pan") {
      const dx = e.clientX - g.lastX;
      const dy = e.clientY - g.lastY;
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      if (
        Math.abs(e.clientX - g.startX) > TAP_SLOP_PX ||
        Math.abs(e.clientY - g.startY) > TAP_SLOP_PX
      ) {
        g.moved = true;
      }
      const v = viewRef.current;
      if (v.scale > MIN_SCALE) {
        apply(clampView({ ...v, tx: v.tx + dx, ty: v.ty + dy }, rect));
      }
    }
  };

  const onPointerUp = (e) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);

    // Double-tap detection for touch/pen; the mouse uses onDoubleClick.
    if (g?.type === "pan" && !g.moved && e.pointerType !== "mouse") {
      const now = Date.now();
      const prev = lastTap.current;
      const near =
        Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_PX;
      if (now - prev.t < DOUBLE_TAP_MS && near) {
        lastTap.current = { t: 0, x: 0, y: 0 };
        toggleZoom(e.clientX, e.clientY);
      } else {
        lastTap.current = { t: now, x: e.clientX, y: e.clientY };
      }
    }

    if (pointers.current.size === 0) {
      gesture.current = null;
      setDragging(false);
    } else if (pointers.current.size === 1) {
      // Pinch → one finger lifted: continue as a pan.
      const [p] = pointers.current.values();
      gesture.current = {
        type: "pan",
        startX: p.x,
        startY: p.y,
        lastX: p.x,
        lastY: p.y,
        moved: true,
      };
    }
  };

  const zoomed = view.scale > MIN_SCALE;

  return (
    <div
      ref={boxRef}
      className={cx(
        "relative overflow-hidden bg-sunken select-none",
        className,
      )}
      style={{ touchAction: zoomed ? "none" : "pan-y" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => toggleZoom(e.clientX, e.clientY)}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={onLoad}
        onError={onError}
        className={cx(
          "block h-full w-full object-contain will-change-transform",
          !dragging && "transition-transform duration-150 ease-out",
        )}
        style={{
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
        }}
      />
      {hint && !zoomed && (
        <span
          className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-muted"
          aria-hidden="true"
        >
          {hint}
        </span>
      )}
    </div>
  );
}
