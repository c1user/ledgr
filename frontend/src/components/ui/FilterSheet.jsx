import Modal from "./Modal";
import Button from "./Button";

// Phone-first filtering. On narrow screens a list page shows one
// <FilterButton> (with a badge for how many filters are active) instead of
// a row of controls; tapping it opens a <FilterSheet> — a bottom sheet (the
// shared Modal) holding the full set of filter controls. The sheet edits a
// DRAFT the page owns; nothing refetches until the user taps Apply, so a
// date range can be typed in full without the list reloading on every
// keystroke.

export function FilterButton({ count = 0, label, className, ...rest }) {
  return (
    <Button
      icon="ti-filter"
      className={className}
      aria-haspopup="dialog"
      {...rest}
    >
      {label}
      {count > 0 && (
        <span
          className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-on-brand text-[11px] font-semibold leading-none"
          aria-label={`${count}`}
        >
          {count}
        </span>
      )}
    </Button>
  );
}

export default function FilterSheet({
  open,
  onClose,
  title,
  onApply,
  onClear,
  applyLabel,
  clearLabel,
  children,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          {onClear && (
            <Button icon="ti-x" onClick={onClear}>
              {clearLabel}
            </Button>
          )}
          <Button variant="primary" icon="ti-check" onClick={onApply}>
            {applyLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
