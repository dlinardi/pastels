import { describe, expect, it } from "vitest";
import { pngDimensions } from "./png";

const PNG_2x3 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAC0lEQVR4nGNgwAkAABsAAco8Sg0AAAAASUVORK5CYII=",
  "base64"
);
const PNG_4x2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAC0lEQVR4nGNgIAQAACIAAV64IdsAAAAASUVORK5CYII=",
  "base64"
);

describe("pngDimensions", () => {
  it("reads width and height from IHDR", () => {
    expect(pngDimensions(PNG_2x3)).toEqual({ width: 2, height: 3 });
    expect(pngDimensions(PNG_4x2)).toEqual({ width: 4, height: 2 });
  });

  it("returns null for non-PNG bytes", () => {
    expect(pngDimensions(Buffer.from("not a png at all here"))).toBeNull();
  });

  it("returns null for a too-short buffer", () => {
    expect(pngDimensions(Buffer.from([0x89, 0x50]))).toBeNull();
  });

  it("returns null when the signature is wrong", () => {
    const bad = Buffer.from(PNG_2x3);
    bad[1] = 0x00;
    expect(pngDimensions(bad)).toBeNull();
  });
});
