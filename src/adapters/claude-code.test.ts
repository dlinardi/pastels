import path from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeCodeTranscriptAdapter, slugForCwd } from "./claude-code";
import type { Session } from "./types";

const FIXTURE = path.resolve(process.cwd(), "test/fixtures/transcript.jsonl");

function fixtureSession(): Session {
  return { id: "fixture-session", path: FIXTURE, project: "fixture", mtime: 0 };
}

describe("ClaudeCodeTranscriptAdapter — canary", () => {
  const adapter = new ClaudeCodeTranscriptAdapter();

  it("parses the fixture without throwing on garbage/malformed lines", () => {
    expect(() => adapter.extractImages(fixtureSession())).not.toThrow();
  });

  it("recovers every recoverable image, skipping the data-less block", () => {
    const imgs = adapter.extractImages(fixtureSession());
    // 5 recoverable; the final block has no source.data and is skipped
    expect(imgs).toHaveLength(5);
  });

  it("labels images from imagePasteIds, not appearance order", () => {
    const imgs = adapter.extractImages(fixtureSession());
    expect(imgs.map((i) => i.label)).toEqual([1, 4, 5, 9, 5]);
    expect(imgs.map((i) => i.appearance)).toEqual([1, 2, 3, 4, 5]);
  });

  it("falls back to text refs, then to appearance order (uncertain)", () => {
    const imgs = adapter.extractImages(fixtureSession());
    // [1,4] and [5] come from imagePasteIds (certain); [9] from a text ref
    // (certain); the last has neither → appearance fallback, uncertain.
    expect(imgs.map((i) => i.uncertain)).toEqual([false, false, false, false, true]);
  });

  it("decodes real PNG bytes with correct media type", () => {
    const imgs = adapter.extractImages(fixtureSession());
    expect(imgs[0]!.mediaType).toBe("image/png");
    // first image is the 2x3 PNG
    expect(imgs[0]!.bytes.length).toBeGreaterThan(0);
    expect(imgs[0]!.bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  });

  it("returns [] for a missing transcript instead of throwing", () => {
    expect(
      adapter.extractImages({ id: "x", path: "/no/such/file.jsonl", project: "p", mtime: 0 })
    ).toEqual([]);
  });
});

describe("slugForCwd", () => {
  it("collapses non-alphanumerics to dashes (Claude Code's rule)", () => {
    expect(slugForCwd("/Users/dave/Developer/pastels")).toBe(
      "-Users-dave-Developer-pastels"
    );
  });
});
