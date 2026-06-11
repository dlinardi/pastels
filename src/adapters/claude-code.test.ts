import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

describe("summarize", () => {
  const adapter = new ClaudeCodeTranscriptAdapter();
  it("derives title, image count, and timestamp without decoding base64", () => {
    const info = adapter.summarize(fixtureSession());
    expect(info.imageCount).toBe(6); // all image blocks incl. the data-less one
    expect(info.title).toContain("[Image #1]"); // first user text block
    expect(info.startedAt).toBe("2026-06-01T10:00:00.000Z");
  });
  it("degrades to a placeholder title for an unreadable transcript", () => {
    const info = adapter.summarize({ id: "x", path: "/no/such.jsonl", project: "p", mtime: 0 });
    expect(info.imageCount).toBe(0);
    expect(info.title).toBe("(unreadable)");
  });
});

describe("liveImages — paste-time image cache", () => {
  const adapter = new ClaudeCodeTranscriptAdapter();
  let tmp: string | undefined;

  afterEach(() => {
    delete process.env.CLAUDE_IMAGE_CACHE_DIR;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  function sess(id: string): Session {
    return { id, path: "/x", project: "p", mtime: 0 };
  }

  it("reads <session>/N.png with the filename N as the [Image #N] label", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pastels-cache-"));
    process.env.CLAUDE_IMAGE_CACHE_DIR = tmp;
    fs.mkdirSync(path.join(tmp, "s1"));
    // written out of numeric order to prove we sort by paste id, not name/mtime
    fs.writeFileSync(path.join(tmp, "s1", "2.png"), Buffer.from("bb"));
    fs.writeFileSync(path.join(tmp, "s1", "1.png"), Buffer.from("a"));

    const imgs = adapter.liveImages!(sess("s1"));
    expect(imgs.map((i) => i.label)).toEqual([1, 2]);
    expect(imgs.map((i) => i.appearance)).toEqual([1, 2]);
    expect(imgs.map((i) => i.uncertain)).toEqual([false, false]);
    expect(imgs[0]!.bytes.length).toBe(1);
    expect(imgs[1]!.bytes.length).toBe(2);
    expect(imgs[0]!.mediaType).toBe("image/png");
  });

  it("skips empty (half-written) files and ignores non-png entries", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pastels-cache-"));
    process.env.CLAUDE_IMAGE_CACHE_DIR = tmp;
    fs.mkdirSync(path.join(tmp, "s1"));
    fs.writeFileSync(path.join(tmp, "s1", "1.png"), Buffer.from("a"));
    fs.writeFileSync(path.join(tmp, "s1", "2.png"), Buffer.alloc(0)); // mid-write
    fs.writeFileSync(path.join(tmp, "s1", "notes.txt"), Buffer.from("x"));

    expect(adapter.liveImages!(sess("s1")).map((i) => i.label)).toEqual([1]);
  });

  it("returns [] when the session has no cache dir", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pastels-cache-"));
    process.env.CLAUDE_IMAGE_CACHE_DIR = tmp;
    expect(adapter.liveImages!(sess("absent"))).toEqual([]);
  });
});

describe("slugForCwd", () => {
  it("collapses non-alphanumerics to dashes (Claude Code's rule)", () => {
    expect(slugForCwd("/Users/dave/Developer/pastels")).toBe(
      "-Users-dave-Developer-pastels"
    );
  });
});
