import { describe, expect, it } from "vitest";
import { formatRepositoryJson } from "./repository-json.js";

describe("formatRepositoryJson (Biome-compatible repository JSON)", () => {
  it("is deterministic for the same parsed value", () => {
    const value = { a: [1, 2, 3], b: { c: "x" } };
    expect(formatRepositoryJson(value)).toBe(formatRepositoryJson(value));
  });

  it("round-trips to the same object", () => {
    const value = {
      tags: ["clob", "quote"],
      path: ["native", "0x754704Bc059F8C67012fEd69BC8A327a5aafb603"],
      data: "0x00000000000000000000000000000000000000000000000000000000000000df",
      nested: [{ kind: "event", address: "0x1" }],
      empty: [],
      objectEmpty: {},
      n: 1,
      b: true,
      nil: null,
    };
    expect(JSON.parse(formatRepositoryJson(value))).toEqual(value);
  });

  it("collapses short arrays and inline objects onto one line", () => {
    expect(
      formatRepositoryJson({ a: [1, 2, 3], b: [{ k: 1 }, { k: 2 }] }),
    ).toBe('{ "a": [1, 2, 3], "b": [{ "k": 1 }, { "k": 2 }] }\n');
  });

  it("expands arrays and objects that exceed the 80-column line width", () => {
    const value = {
      c: [
        "a-long-string-that-goes-past-eighty-characters-easily-with-the-indent",
        "b",
      ],
    };
    expect(formatRepositoryJson(value)).toBe(
      '{\n  "c": [\n    "a-long-string-that-goes-past-eighty-characters-easily-with-the-indent",\n    "b"\n  ]\n}\n',
    );
  });

  it("ends with exactly one trailing newline", () => {
    const output = formatRepositoryJson({ a: 1 });
    expect(output.endsWith("\n")).toBe(true);
    expect(output.endsWith("\n\n")).toBe(false);
  });

  it("formats empty collections inline", () => {
    expect(formatRepositoryJson({ e: [], f: { g: [] } })).toBe(
      '{ "e": [], "f": { "g": [] } }\n',
    );
  });
});
