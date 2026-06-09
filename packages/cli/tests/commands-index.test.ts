import { describe, expect, test } from "bun:test";
import { buildRegistry } from "../src/commands/index";

describe("buildRegistry", () => {
  test("registers all commands", () => {
    const names = buildRegistry()
      .all()
      .map((c) => c.name)
      .sort();
    expect(names).toEqual([
      "add",
      "cancel",
      "dep",
      "done",
      "events",
      "list",
      "note",
      "reopen",
      "restore",
      "rm",
      "show",
      "start",
      "status",
      "update",
    ]);
  });
});
