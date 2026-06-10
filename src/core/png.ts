// Read PNG dimensions straight from the IHDR header — no imagemagick (PRD §5.3).
//
// PNG layout: 8-byte signature, then the IHDR chunk:
//   [4 len][4 "IHDR"][4 width BE][4 height BE]...
// so width is at byte 16 and height at byte 20.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function pngDimensions(
  buf: Buffer
): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) return null;
  }
  // IHDR must be the first chunk; its type tag sits at bytes 12..15.
  if (buf.toString("latin1", 12, 16) !== "IHDR") return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

// JPEG dimensions live in the SOF (Start Of Frame) marker. Scan the marker
// segments until we hit one — no decoding, no dependency.
export function jpegDimensions(
  buf: Buffer
): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) {
      off++; // resync on padding
      continue;
    }
    const marker = buf[off + 1]!;
    // standalone markers carry no length payload
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      off += 2;
      continue;
    }
    const len = buf.readUInt16BE(off + 2);
    // SOF0..SOF15, excluding DHT(C4), JPG(C8), DAC(CC)
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      const height = buf.readUInt16BE(off + 5);
      const width = buf.readUInt16BE(off + 7);
      if (width === 0 || height === 0) return null;
      return { width, height };
    }
    off += 2 + len;
  }
  return null;
}

/** Read dimensions for any image we can read header-only: PNG or JPEG. */
export function imageDimensions(
  buf: Buffer
): { width: number; height: number } | null {
  return pngDimensions(buf) ?? jpegDimensions(buf);
}

const EXT_BY_MEDIA: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/** File extension for a media type; `.bin` for anything unrecognised. */
export function extForMedia(mediaType: string): string {
  return EXT_BY_MEDIA[mediaType] ?? ".bin";
}

/** Can the kitty renderer paint this directly? Only PNG (f=100), no decoder. */
export function isRenderable(mediaType: string): boolean {
  return mediaType === "image/png";
}
