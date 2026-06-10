import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CapturedImage } from "../adapters/types";
import { gc, imagesDir, indexPath, ingest, readIndex } from "./store";

const PNG_2x3 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAC0lEQVR4nGNgwAkAABsAAco8Sg0AAAAASUVORK5CYII=",
  "base64"
);
const PNG_4x2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAC0lEQVR4nGNgIAQAACIAAV64IdsAAAAASUVORK5CYII=",
  "base64"
);

function img(bytes: Buffer, label: number): CapturedImage {
  return {
    label,
    appearance: label,
    uncertain: false,
    bytes,
    mediaType: "image/png",
    ts: "2026-06-01T10:00:00.000Z",
    sessionId: "s1",
  };
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pastels-test-"));
  process.env.PASTELS_DIR = tmp;
});
afterEach(() => {
  delete process.env.PASTELS_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("ingest", () => {
  it("writes content-addressed PNGs and records dims", () => {
    const stored = ingest([img(PNG_2x3, 1), img(PNG_4x2, 4)], "test:s1");
    expect(stored).toHaveLength(2);
    expect(stored[0]!.width).toBe(2);
    expect(stored[0]!.height).toBe(3);
    expect(fs.existsSync(stored[0]!.file)).toBe(true);
    expect(fs.readdirSync(imagesDir())).toHaveLength(2);
  });

  it("dedupes identical bytes into one file but keeps distinct labels", () => {
    // same image pasted under two different labels
    const stored = ingest([img(PNG_2x3, 1), img(PNG_2x3, 9)], "test:s1");
    expect(stored[0]!.hash).toBe(stored[1]!.hash);
    expect(fs.readdirSync(imagesDir())).toHaveLength(1);
    expect(readIndex()).toHaveLength(2); // two (hash,label) records
  });

  it("does not duplicate index records across repeated ingests", () => {
    ingest([img(PNG_2x3, 1)], "test:s1");
    ingest([img(PNG_2x3, 1)], "test:s1");
    expect(readIndex()).toHaveLength(1);
  });
});

describe("gc", () => {
  it("removes images older than the cutoff and prunes their index entries", () => {
    const stored = ingest([img(PNG_2x3, 1)], "test:s1");
    // backdate the file mtime by 30 days
    const old = new Date(Date.now() - 30 * 86_400_000);
    fs.utimesSync(stored[0]!.file, old, old);

    const res = gc(7);
    expect(res.filesDeleted).toBe(1);
    expect(res.entriesPruned).toBe(1);
    expect(fs.existsSync(stored[0]!.file)).toBe(false);
    expect(readIndex()).toHaveLength(0);
  });

  it("keeps recently-touched images", () => {
    const stored = ingest([img(PNG_2x3, 1)], "test:s1");
    const res = gc(7);
    expect(res.filesDeleted).toBe(0);
    expect(fs.existsSync(stored[0]!.file)).toBe(true);
  });

  it("is a no-op when the store is empty", () => {
    expect(gc(7)).toEqual({ filesDeleted: 0, entriesPruned: 0 });
    expect(fs.existsSync(indexPath())).toBe(false);
  });
});
