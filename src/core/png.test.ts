import { describe, expect, it } from "vitest";
import {
  extForMedia,
  imageDimensions,
  isRenderable,
  jpegDimensions,
  pngDimensions,
} from "./png";

// minimal JPEG: SOI + APP0/JFIF + SOF0 declaring 16x9 + EOI
const JPEG_16x9 = Buffer.from([
  0xff, 0xd8, // SOI
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, // APP0
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x09, 0x00, 0x10, 0x03, 0x01, 0x22, 0x00,
  0x02, 0x11, 0x01, 0x03, 0x11, 0x01, // SOF0: precision 8, height 0x0009, width 0x0010
  0xff, 0xd9, // EOI
]);

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

describe("jpegDimensions", () => {
  it("reads width and height from the SOF marker", () => {
    expect(jpegDimensions(JPEG_16x9)).toEqual({ width: 16, height: 9 });
  });
  it("returns null for non-JPEG bytes", () => {
    expect(jpegDimensions(PNG_2x3)).toBeNull();
  });
});

describe("imageDimensions", () => {
  it("dispatches by format", () => {
    expect(imageDimensions(PNG_2x3)).toEqual({ width: 2, height: 3 });
    expect(imageDimensions(JPEG_16x9)).toEqual({ width: 16, height: 9 });
    expect(imageDimensions(Buffer.from("nope"))).toBeNull();
  });
});

describe("extForMedia / isRenderable", () => {
  it("maps media types to extensions", () => {
    expect(extForMedia("image/png")).toBe(".png");
    expect(extForMedia("image/jpeg")).toBe(".jpg");
    expect(extForMedia("image/weird")).toBe(".bin");
  });
  it("only PNG is directly renderable by kitty", () => {
    expect(isRenderable("image/png")).toBe(true);
    expect(isRenderable("image/jpeg")).toBe(false);
  });
});
