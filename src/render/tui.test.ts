import { describe, expect, it } from "vitest";
import type { Session, SessionInfo } from "../adapters/types";
import { filterRows, type PickRow } from "./tui";

function row(branch: string, title: string, cwd?: string): PickRow {
  const s: Session = { id: branch, path: "/x", project: "p", mtime: 0 };
  const info: SessionInfo = { title, gitBranch: branch, cwd, imageCount: 1 };
  return { s, info };
}

const rows = [
  row("main", "Add a cache layer", "/home/dave/lane"),
  row("ui-streaming", "Create a presentation deck", "/home/dave/meraklis"),
  row("engine", "Investigation loop in agent.ts"),
];

describe("filterRows", () => {
  it("returns all rows for an empty query", () => {
    expect(filterRows(rows, "")).toHaveLength(3);
    expect(filterRows(rows, "   ")).toHaveLength(3);
  });
  it("matches on branch", () => {
    expect(filterRows(rows, "engine").map((r) => r.info.title)).toEqual([
      "Investigation loop in agent.ts",
    ]);
  });
  it("matches on title, case-insensitively", () => {
    expect(filterRows(rows, "CACHE")).toHaveLength(1);
  });
  it("matches on cwd", () => {
    expect(filterRows(rows, "meraklis")).toHaveLength(1);
  });
  it("returns nothing when no row matches", () => {
    expect(filterRows(rows, "zzz")).toHaveLength(0);
  });
});
