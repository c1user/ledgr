/**
 * BrandMark — the Abaco icon (Ink & plum identity).
 * Same geometry as public/favicon.svg and scripts/generate-icons.mjs;
 * fixed identity colors so it reads the same in light and dark themes.
 */
export default function BrandMark({ size = 48, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Abaco"
    >
      <rect width="64" height="64" rx="14" fill="#5b3a9b" />
      <g stroke="#472a7e" strokeWidth="1.5">
        <line x1="10.9" y1="20.5" x2="53.1" y2="20.5" />
        <line x1="10.9" y1="32" x2="53.1" y2="32" />
        <line x1="10.9" y1="43.5" x2="53.1" y2="43.5" />
      </g>
      <g fill="#ffffff">
        <circle cx="17.9" cy="20.5" r="4.8" />
        <circle cx="28.8" cy="20.5" r="4.8" />
        <circle cx="35.2" cy="32" r="4.8" />
        <circle cx="46.1" cy="32" r="4.8" />
        <circle cx="17.9" cy="43.5" r="4.8" />
        <circle cx="39.7" cy="43.5" r="4.8" />
      </g>
      <g fill="#f0895c">
        <circle cx="46.1" cy="20.5" r="4.8" />
        <circle cx="17.9" cy="32" r="4.8" />
        <circle cx="28.8" cy="43.5" r="4.8" />
      </g>
    </svg>
  );
}
