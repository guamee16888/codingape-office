export function normalizeUser(input = {}) {
  return {
    email: String(input.email || "").toLowerCase(),
    name: input.name || ""
  };
}
