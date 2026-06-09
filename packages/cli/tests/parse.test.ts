import { describe, expect, test } from "bun:test";
import { InvalidDateExprError } from "@tasq/core";
import { noneToNull, parseDateOption, parseId, parseIds, parsePriority, parseTokens } from "../src/parse";

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

describe("parseIds", () => {
  test("parses a list of positive integers", () => {
    expect(parseIds(["1", "42"])).toEqual([1, 42]);
  });

  test("returns null for empty input or any invalid element", () => {
    expect(parseIds([])).toBeNull();
    expect(parseIds(["1", "x"])).toBeNull();
    expect(parseIds(["0"])).toBeNull();
  });
});

describe("noneToNull", () => {
  test("maps the literal none to null and passes through others", () => {
    expect(noneToNull("none")).toBeNull();
    expect(noneToNull("tasq")).toBe("tasq");
  });
});

describe("parseDateOption", () => {
  const now = new Date(2026, 5, 10);

  test("resolves date expressions to ISO", () => {
    expect(parseDateOption("tomorrow", now)).toBe("2026-06-11");
  });

  test("maps none to null", () => {
    expect(parseDateOption("none", now)).toBeNull();
  });

  test("throws on invalid expressions", () => {
    expect(() => parseDateOption("blah", now)).toThrow(InvalidDateExprError);
  });
});
