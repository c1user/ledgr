import { useEffect, useRef } from "react";

/**
 * Long-press detection for a tappable element. Spread the returned props on
 * the element; keep passing your own onClick — the click that follows a
 * long-press is swallowed so both gestures can live on the same element.
 * A pointer that moves more than `moveTolerance` px (scrolling) cancels.
 */
export default function useLongPress(
  onLongPress,
  { delay = 500, moveTolerance = 10 } = {},
) {
  const timer = useRef(null);
  const origin = useRef(null);
  const fired = useRef(false);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    fired.current = false;
    origin.current = { x: e.clientX, y: e.clientY };
    clear();
    timer.current = setTimeout(() => {
      timer.current = null;
      fired.current = true;
      onLongPress?.(e);
    }, delay);
  };

  const onPointerMove = (e) => {
    if (!timer.current || !origin.current) return;
    if (
      Math.abs(e.clientX - origin.current.x) > moveTolerance ||
      Math.abs(e.clientY - origin.current.y) > moveTolerance
    ) {
      clear();
    }
  };

  const onClickCapture = (e) => {
    if (fired.current) {
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // The browser's own long-press menu (copy / share) would fight the gesture.
  const onContextMenu = (e) => e.preventDefault();

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClickCapture,
    onContextMenu,
  };
}
