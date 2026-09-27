import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cx from "@abaco/ui/cx";

// Touch-based pull-to-refresh. The page scrolls inside the Shell's <main>,
// so the gesture only starts while that scroll container sits at the top.
// Pulling grows an indicator strip above the content (no transforms, so
// `sticky` children keep working); finger travel > THRESHOLD_PX at release
// calls onRefresh() and keeps the spinner until its promise settles.
const THRESHOLD_PX = 70;
const DAMPING = 0.55;
const MAX_PULL_PX = 110;
const BUSY_HEIGHT_PX = 44;

function scrollParent(el) {
  let node = el?.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return typeof document !== "undefined" ? document.scrollingElement : null;
}

export default function PullToRefresh({
  onRefresh,
  refreshing = false,
  disabled = false,
  className,
  children,
}) {
  const { t } = useTranslation();
  const rootRef = useRef(null);
  const gesture = useRef(null); // { startY, scroller, travel }
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = busy || refreshing;

  const onTouchStart = (e) => {
    if (disabled || active || e.touches.length !== 1) return;
    const scroller = scrollParent(rootRef.current);
    if (scroller && scroller.scrollTop > 0) return;
    gesture.current = { startY: e.touches[0].clientY, scroller, travel: 0 };
  };

  const onTouchMove = (e) => {
    const g = gesture.current;
    if (!g) return;
    const dy = e.touches[0].clientY - g.startY;
    if (dy <= 0 || (g.scroller && g.scroller.scrollTop > 0)) {
      g.travel = 0;
      if (pull !== 0) setPull(0);
      return;
    }
    g.travel = dy;
    if (!dragging) setDragging(true);
    setPull(Math.min(dy * DAMPING, MAX_PULL_PX));
  };

  const end = () => {
    const g = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (!g) return;
    if (g.travel > THRESHOLD_PX && typeof onRefresh === "function") {
      setBusy(true);
      setPull(BUSY_HEIGHT_PX);
      Promise.resolve()
        .then(() => onRefresh())
        .catch(() => {})
        .finally(() => {
          setBusy(false);
          setPull(0);
        });
    } else {
      setPull(0);
    }
  };

  const armed = pull * (1 / DAMPING) > THRESHOLD_PX;
  const height = active ? BUSY_HEIGHT_PX : pull;

  return (
    <div
      ref={rootRef}
      className={cx("relative", className)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={end}
      onTouchCancel={end}
    >
      <div
        role="status"
        aria-live="polite"
        className={cx(
          "flex items-center justify-center gap-2 overflow-hidden text-xs text-muted",
          !dragging && "transition-[height] duration-200 ease-out",
        )}
        style={{ height }}
      >
        {active ? (
          <>
            <i className="ti ti-loader-2 animate-spin" aria-hidden="true" />
            <span>{t("mobile.common.loading")}</span>
          </>
        ) : height > 0 ? (
          <>
            <i
              className={cx(
                "ti ti-arrow-down transition-transform",
                armed && "rotate-180",
              )}
              aria-hidden="true"
            />
            <span>{t("mobile.receipts.pullToRefresh")}</span>
          </>
        ) : null}
      </div>
      {children}
    </div>
  );
}
