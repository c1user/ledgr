import { useCallback, useEffect, useRef, useState } from "react";
import cx from "@abaco/ui/cx";

// A list row that slides left to reveal action buttons (each ACTION_WIDTH px
// wide, full row height, ≥44px tall). Pointer events cover touch and mouse;
// `touch-pan-y` lets the browser keep vertical scrolling while horizontal
// drags reach us. Only one row is open at a time (module-level latch).
const ACTION_WIDTH = 76;
const AXIS_LOCK_PX = 6;

const TONES = {
  brand: "bg-brand text-on-brand",
  danger: "bg-danger text-on-brand",
  neutral: "bg-sunken text-ink",
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

let closeOpenRow = null;

/**
 * @param {Array<{key:string,label:string,icon?:string,tone?:"brand"|"danger"|"neutral",onClick:Function}>} actions
 */
export default function SwipeRow({
  actions = [],
  disabled = false,
  className,
  children,
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null); // { id, x, y, startOffset, axis, current, moved }
  const suppressClick = useRef(false);
  const width = actions.length * ACTION_WIDTH;
  const open = offset > 0;

  const close = useCallback(() => setOffset(0), []);

  useEffect(
    () => () => {
      if (closeOpenRow === close) closeOpenRow = null;
    },
    [close],
  );

  const onPointerDown = (e) => {
    if (disabled || !actions.length) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      startOffset: offset,
      current: offset,
      axis: null,
      moved: false,
    };
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.axis) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (d.axis === "x") {
        setDragging(true);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* capture is best-effort */
        }
      }
    }
    if (d.axis !== "x") return;
    d.moved = true;
    d.current = clamp(d.startOffset - dx, 0, width);
    setOffset(d.current);
  };

  const finish = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (d.axis !== "x") return;
    suppressClick.current = d.moved;
    const shouldOpen = d.current > width / 2;
    setOffset(shouldOpen ? width : 0);
    if (shouldOpen) {
      if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
      closeOpenRow = close;
    } else if (closeOpenRow === close) {
      closeOpenRow = null;
    }
  };

  // A tap on the content after a drag must not activate it; a tap while the
  // actions are showing just closes them.
  const onClickCapture = (e) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div
      className={cx(
        "relative overflow-hidden touch-pan-y select-none",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <div
        className="absolute inset-y-0 right-0 flex"
        style={{ width }}
        aria-hidden={!open}
      >
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            tabIndex={open ? 0 : -1}
            onClick={() => {
              close();
              closeOpenRow = null;
              a.onClick?.();
            }}
            className={cx(
              "flex h-full min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
              TONES[a.tone] || TONES.neutral,
            )}
            style={{ width: ACTION_WIDTH }}
          >
            {a.icon && (
              <i className={cx("ti text-lg", a.icon)} aria-hidden="true" />
            )}
            <span>{a.label}</span>
          </button>
        ))}
      </div>
      <div
        className={cx(
          "relative bg-surface",
          !dragging && "transition-transform duration-200 ease-out",
        )}
        style={{ transform: `translateX(${-offset}px)` }}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  );
}
