/**
 * Live-test safety harness - protected-world matching.
 *
 * No real world identifiers live in the repository. The worlds to protect
 * come only from the local, gitignored snapshot (protected-worlds.json) that
 * the harness records on its first run.
 */

/** Every resource the tests create must be named with this prefix. */
export const TEST_PREFIX = "MCP-TEST-";

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Collect every string leaf from a value (objects, arrays, primitives). */
function collectStrings(value, out = []) {
  if (value === null || value === undefined) return out;
  if (typeof value === "string") out.push(value);
  else if (typeof value === "number" || typeof value === "boolean")
    out.push(String(value));
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      collectStrings(v, out);
    }
  return out;
}

/**
 * Split any value into lowercase candidate tokens (UUIDs, slugs, words).
 * URL-encoded text is decoded first so encoding cannot hide an identifier.
 */
export function extractTokens(...values) {
  const tokens = new Set();
  for (const raw of collectStrings(values)) {
    let text = raw;
    try {
      text = decodeURIComponent(raw);
    } catch {
      // keep raw text if it is not valid URI encoding
    }
    text = text.toLowerCase();
    tokens.add(text.trim());
    for (const m of text.match(UUID_RE) || []) tokens.add(m);
    for (const t of text.split(/[^a-z0-9-]+/)) if (t) tokens.add(t);
  }
  return tokens;
}

/** Extract UUIDs only (used for ledger membership checks). */
export function extractUuids(...values) {
  const ids = new Set();
  for (const text of collectStrings(values))
    for (const m of text.match(UUID_RE) || []) ids.add(m.toLowerCase());
  return ids;
}

/**
 * Return a description of the first protected reference found, or null.
 *
 * @param {Set<string>} tokens - from extractTokens()
 * @param {Set<string>} localProtected - lowercase IDs/slugs from protected-worlds.json
 */
export function findProtectedReference(tokens, localProtected = new Set()) {
  for (const token of tokens)
    if (localProtected.has(token)) return "protected world";
  return null;
}
