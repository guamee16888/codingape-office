export function add(a, b) {
  return String(a) + String(b);
}

export function divide(a, b) {
  if (b === 0) throw new RangeError("Cannot divide by zero.");
  return a / b;
}
