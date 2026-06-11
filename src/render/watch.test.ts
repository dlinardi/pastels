import { describe, expect, it } from "vitest";
import type { CaptureAdapter, CapturedImage, Session, SessionInfo } from "../adapters/types";
import type { StoredImage } from "../core/store";
import { activeSession, pickLatest } from "./watch";

function img(over: Partial<StoredImage>): StoredImage {
  return {
    label: 1,
    appearance: 1,
    uncertain: false,
    hash: "h",
    file: "/x.png",
    width: 10,
    height: 10,
    bytes: 100,
    mediaType: "image/png",
    ts: "2026-06-10T00:00:00.000Z",
    source: "claude-code:s",
    ...over,
  };
}

describe("pickLatest", () => {
  it("returns the highest-appearance image (the newest paste)", () => {
    const images = [
      img({ appearance: 1, hash: "a" }),
      img({ appearance: 3, hash: "c" }),
      img({ appearance: 2, hash: "b" }),
    ];
    expect(pickLatest(images, true)?.hash).toBe("c");
  });

  it("skips non-renderable formats in graphics mode", () => {
    const images = [
      img({ appearance: 1, hash: "png" }),
      img({ appearance: 2, hash: "jpg", mediaType: "image/jpeg" }),
    ];
    // jpeg is the newest but not kitty-renderable → fall back to the PNG
    expect(pickLatest(images, true)?.hash).toBe("png");
  });

  it("includes any format in text mode", () => {
    const images = [
      img({ appearance: 1, hash: "png" }),
      img({ appearance: 2, hash: "jpg", mediaType: "image/jpeg" }),
    ];
    expect(pickLatest(images, false)?.hash).toBe("jpg");
  });

  it("returns undefined for an empty set", () => {
    expect(pickLatest([], true)).toBeUndefined();
  });

  it("returns undefined when nothing is renderable in graphics mode", () => {
    expect(pickLatest([img({ mediaType: "image/jpeg" })], true)).toBeUndefined();
  });
});

// Minimal fake adapter that only exercises listSessions (what activeSession uses).
function fakeAdapter(sessions: Session[]): CaptureAdapter {
  return {
    name: "fake",
    detect: () => true,
    listSessions: () => sessions,
    extractImages: (): CapturedImage[] => [],
    summarize: (): SessionInfo => ({ title: "", imageCount: 0 }),
  };
}

function session(id: string, project: string, mtime: number): Session {
  return { id, project, mtime, path: `/${id}.jsonl` };
}

describe("activeSession", () => {
  it("returns the newest-mtime session in the project", () => {
    // listSessions() contract is mtime-desc; activeSession takes the first match
    const a = fakeAdapter([
      session("new", "proj", 300),
      session("mid", "proj", 200),
      session("old", "proj", 100),
    ]);
    expect(activeSession(a, "proj")?.id).toBe("new");
  });

  it("never crosses into another project", () => {
    const a = fakeAdapter([
      session("other-newest", "other", 999),
      session("mine", "proj", 100),
    ]);
    expect(activeSession(a, "proj")?.id).toBe("mine");
  });

  it("returns null when the project has no sessions", () => {
    const a = fakeAdapter([session("x", "other", 100)]);
    expect(activeSession(a, "proj")).toBeNull();
  });
});
