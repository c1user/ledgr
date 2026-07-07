// Join class names, skipping falsy values.
export default function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}
