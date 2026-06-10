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
