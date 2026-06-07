import { describe, expect, test } from "bun:test";
import { parseId, parsePriority, parseTokens } from "../src/parse";

describe("parseId", () => {
  test("parses positive integer strings", () => {
    expect(parseId("42")).toBe(42);
  });

  test("returns null for undefined, non-integer or non-positive", () => {
    expect(parseId(undefined)).toBeNull();
    expect(parseId("abc")).toBeNull();
    expect(parseId("1.5")).toBeNull();
    expect(parseId("0")).toBeNull();
    expect(parseId("-3")).toBeNull();
  });
});

describe("parsePriority", () => {
  test("parses finite number strings", () => {
    expect(parsePriority("3")).toBe(3);
    expect(parsePriority("-1")).toBe(-1);
  });

  test("returns null for non-numeric input", () => {
    expect(parsePriority("high")).toBeNull();
  });
});

describe("parseTokens", () => {
  test("extracts +tag, :project and ^priority tokens", () => {
    expect(parseTokens(["fix", "bug", "+a", "+b", ":web", "^2"])).toEqual({
      words: ["fix", "bug"],
      tags: ["a", "b"],
      project: "web",
      priority: 2,
    });
  });

  test("treats bare sigils and args with whitespace as words", () => {
    expect(parseTokens(["+", ":", "^", "+1 button"])).toEqual({
      words: ["+", ":", "^", "+1 button"],
      tags: [],
      project: undefined,
      priority: undefined,
    });
  });

  test("keeps non-numeric ^ tokens as words", () => {
    expect(parseTokens(["bump", "^head"])).toEqual({
      words: ["bump", "^head"],
      tags: [],
      project: undefined,
      priority: undefined,
    });
  });

  test("last :project and ^priority win", () => {
    expect(parseTokens([":a", ":b", "^1", "^2"])).toEqual({
      words: [],
      tags: [],
      project: "b",
      priority: 2,
    });
  });
});
