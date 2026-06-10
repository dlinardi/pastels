import fs from "node:fs";
import type { Session } from "../adapters/types";
import type { StoredImage } from "../core/store";
import { humanAge, humanDims, humanSize } from "../util/format";
import type { Caps } from "./capability";
import { buildImageSequences, imageIdFromHash, wrap } from "./kitty";

// Bare `pastels`: text gallery of labels + dims + timestamps, always (PRD §5.4
// item 3). Inline thumbnails are appended ONLY when not in tmux, where kitty
// graphics place cleanly; in tmux we print a one-line hint to use `show N`.

export function buildGalleryText(
  images: StoredImage[],
  session?: Session,
  now = Date.now()
): string {
  if (images.length === 0) {
    return "no images found in this session.";
  }

  const rows = images.map((img) => {
    const label = `[Image #${img.label}]${img.uncertain ? " ?" : ""}`;
    return {
      label,
      dims: humanDims(img.width, img.height),
      size: humanSize(img.bytes),
      age: humanAge(img.ts, now),
    };
  });

  const w = {
    label: Math.max(...rows.map((r) => r.label.length), "image".length),
    dims: Math.max(...rows.map((r) => r.dims.length), "size".length),
    size: Math.max(...rows.map((r) => r.size.length), "bytes".length),
  };

  const lines: string[] = [];
  if (session) {
    lines.push(`session ${session.id}  ·  ${images.length} image${images.length === 1 ? "" : "s"}`);
  }
  for (const r of rows) {
    lines.push(
      `  ${r.label.padEnd(w.label)}   ${r.dims.padEnd(w.dims)}   ${r.size.padStart(
        w.size
      )}   ${r.age}`
    );
  }
  if (rows.some((r) => r.label.endsWith("?"))) {
    lines.push("");
    lines.push("  ? = label inferred (no paste id in transcript)");
  }
  return lines.join("\n");
}

const THUMB_ROWS = 6;

/** Print the gallery to stdout, with inline thumbnails only outside tmux. */
export function printGallery(
  images: StoredImage[],
  caps: Caps,
  session?: Session,
  out: NodeJS.WriteStream = process.stdout
): void {
  const thumbs = !caps.inTmux && caps.graphics && caps.isTTY;

  if (!thumbs) {
    out.write(buildGalleryText(images, session) + "\n");
    if (images.length > 0 && caps.inTmux) {
      out.write("\n  in tmux: run `pastels show N` to view an image full-screen.\n");
    }
    return;
  }

  if (images.length === 0) {
    out.write("no images found in this session.\n");
    return;
  }
  if (session) {
    out.write(`session ${session.id}  ·  ${images.length} images\n\n`);
  }
  for (const img of images) {
    const label = `[Image #${img.label}]${img.uncertain ? " ?" : ""}`;
    out.write(
      `${label}  ${humanDims(img.width, img.height)}  ${humanSize(img.bytes)}  ${humanAge(
        img.ts
      )}\n`
    );
    try {
      const bytes = fs.readFileSync(img.file);
      const id = imageIdFromHash(img.hash);
      for (const seq of buildImageSequences(bytes, { id, rows: THUMB_ROWS })) {
        out.write(wrap(seq, caps.inTmux));
      }
      // reserve vertical space so the next row clears the thumbnail
      out.write("\n".repeat(THUMB_ROWS) + "\n");
    } catch {
      out.write("  (image bytes unavailable)\n\n");
    }
  }
}
