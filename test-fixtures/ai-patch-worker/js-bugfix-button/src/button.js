export function getButtonLabel(options = {}) {
  const label = options.label || "";
  if (options.disabled) return label;
  return label;
}
