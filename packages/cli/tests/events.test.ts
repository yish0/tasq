import { describe, expect, test } from "bun:test";
import { eventsCommand } from "../src/commands/events";
import { createTestCli } from "./helpers";

describe("events", () => {
  test("prints events in chronological order", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    ctx.store.setStatus(1, "done");
    expect(eventsCommand.run(["1"], ctx)).toBe(0);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("created");
    expect(out[1]).toContain("status_changed");
  });

  test("prints JSON array with --json", () => {
    const { ctx, out } = createTestCli();
    ctx.store.create({ title: "t" });
    eventsCommand.run(["1", "--json"], ctx);
    const events = JSON.parse(out[0] ?? "");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("created");
  });

  test("prints usage and exits 1 for invalid id", () => {
    const { ctx, err } = createTestCli();
    expect(eventsCommand.run([], ctx)).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  test("prints not found and exits 1 for a missing task", () => {
    const { ctx, err } = createTestCli();
    expect(eventsCommand.run(["99"], ctx)).toBe(1);
    expect(err[0]).toContain("task not found: 99");
  });
});
