import { describe, expect, it } from "vitest";
import type { StoredImage } from "../core/store";
import { buildGalleryText } from "./gallery";

function stored(label: number, w: number, h: number, uncertain = false): StoredImage {
  return {
    label,
    appearance: label,
    uncertain,
    hash: `hash${label}`,
    file: `/tmp/hash${label}.png`,
    width: w,
    height: h,
    bytes: 2048,
    mediaType: "image/png",
    ts: "2026-06-01T10:00:00.000Z",
    source: "test",
    sessionId: "s1",
  };
}

describe("buildGalleryText", () => {
  it("lists labels and dims", () => {
    const text = buildGalleryText([stored(1, 2, 3), stored(4, 4, 2)]);
    expect(text).toContain("[Image #1]");
    expect(text).toContain("[Image #4]");
    expect(text).toContain("2×3");
    expect(text).toContain("4×2");
  });

  it("marks uncertain labels and explains the marker", () => {
    const text = buildGalleryText([stored(5, 1, 1, true)]);
    expect(text).toContain("[Image #5] ?");
    expect(text).toContain("label inferred");
  });

  it("handles the empty case", () => {
    expect(buildGalleryText([])).toContain("no images");
  });
});
