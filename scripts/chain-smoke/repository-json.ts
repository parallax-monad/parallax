/**
 * Deterministic repository JSON serialization matching Biome's canonical JSON
 * formatting for this repository (biome.json: indentWidth 2, default
 * lineWidth 80). The live smoke fixture writer must emit files that pass
 * `pnpm lint` without an external formatting subprocess, and the output must
 * be byte-stable for the same parsed value.
 *
 * Formatting model (mirrors Biome/Prettier JSON):
 * - objects/arrays render inline when the whole line fits the 80-column width;
 * - otherwise objects expand one property per line and arrays one element per
 *   line with 2-space continuation indent;
 * - inline objects use "{ key: value }" spacing; scalars use JSON.stringify.
 */

const LINE_WIDTH = 80;

type RepositoryJsonValue =
  | string
  | number
  | boolean
  | null
  | RepositoryJsonValue[]
  | { [key: string]: RepositoryJsonValue };

function isObject(
  value: RepositoryJsonValue,
): value is { [key: string]: RepositoryJsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalarOf(value: RepositoryJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

/** Recursive single-line rendering of a value (never breaks). */
function inlineOf(value: RepositoryJsonValue): string {
  if (value === null || typeof value !== "object") return scalarOf(value);
  if (Array.isArray(value)) {
    return `[${value.map(inlineOf).join(", ")}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  return `{ ${entries
    .map(([key, child]) => `${JSON.stringify(key)}: ${inlineOf(child)}`)
    .join(", ")} }`;
}

/**
 * Render a value starting at `startColumn` on a line whose base indentation is
 * `baseIndent`; expanded children continue at baseIndent + 2.
 */
function formatValue(
  value: RepositoryJsonValue,
  baseIndent: number,
  startColumn: number,
): string {
  const inline = inlineOf(value);
  if (startColumn + inline.length <= LINE_WIDTH) return inline;

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const childIndent = baseIndent + 2;
    const parts = value.map((child) =>
      formatValue(child, childIndent, childIndent),
    );
    return [
      "[",
      parts.map((part) => `${" ".repeat(childIndent)}${part}`).join(",\n"),
      `${" ".repeat(baseIndent)}]`,
    ].join("\n");
  }

  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const childIndent = baseIndent + 2;
    const parts = entries.map(([key, child]) => {
      const keyText = JSON.stringify(key);
      return `${keyText}: ${formatValue(
        child,
        childIndent,
        childIndent + keyText.length + 2,
      )}`;
    });
    return [
      "{",
      parts.map((part) => `${" ".repeat(childIndent)}${part}`).join(",\n"),
      `${" ".repeat(baseIndent)}}`,
    ].join("\n");
  }

  return inline;
}

/**
 * Serialize a parsed JSON value to Biome-canonical repository text with a
 * deterministic single trailing newline.
 */
export function formatRepositoryJson(value: RepositoryJsonValue): string {
  return `${formatValue(value, 0, 0)}\n`;
}

export type { RepositoryJsonValue };
