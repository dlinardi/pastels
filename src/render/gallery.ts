import fs from "node:fs";
import type { Session, SessionInfo } from "../adapters/types";
import type { StoredImage } from "../core/store";
import { isRenderable } from "../core/png";
import { humanAge, humanDims, humanSize, style } from "../util/format";
import type { Caps } from "./capability";
import { buildImageSequences, imageIdFromHash, wrap } from "./kitty";

// Bare `pastels`: text gallery of labels + dims + timestamps, always (PRD §5.4
// item 3). Inline thumbnails are appended ONLY when not in tmux, where kitty
// graphics place cleanly; in tmux we print a one-line hint to use `show N`.

/** A one/two-line header describing the session: branch · N images · age + title. */
export function galleryHeader(
  session: Session | undefined,
  info: SessionInfo | undefined,
  count: number
): string | null {
  if (!session) return null;
  const parts: string[] = [];
  if (info?.gitBranch) parts.push(style.cyan(info.gitBranch));
  parts.push(`${count} image${count === 1 ? "" : "s"}`);
  if (info?.startedAt) parts.push(style.dim(humanAge(info.startedAt)));
  let header = parts.join(style.dim(" · "));
  if (info?.title) header += "\n" + style.dim(`  "${info.title}"`);
  return header;
}

export function buildGalleryText(
  images: StoredImage[],
  session?: Session,
  info?: SessionInfo,
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
  const header = galleryHeader(session, info, images.length);
  if (header) lines.push(header);
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
  info?: SessionInfo,
  out: NodeJS.WriteStream = process.stdout
): void {
  const thumbs = !caps.inTmux && caps.graphics && caps.isTTY;

  if (!thumbs) {
    out.write(buildGalleryText(images, session, info) + "\n");
    if (images.length > 0 && caps.inTmux) {
      out.write("\n  in tmux: run `pastels show N` to view an image full-screen.\n");
    }
    return;
  }

  if (images.length === 0) {
    out.write("no images found in this session.\n");
    return;
  }
  const header = galleryHeader(session, info, images.length);
  if (header) out.write(header + "\n\n");
  for (const img of images) {
    const label = `[Image #${img.label}]${img.uncertain ? " ?" : ""}`;
    out.write(
      `${label}  ${humanDims(img.width, img.height)}  ${humanSize(img.bytes)}  ${humanAge(
        img.ts
      )}\n`
    );
    if (!isRenderable(img.mediaType)) {
      // kitty paints PNG only; don't emit broken escapes for jpeg/etc.
      out.write(`  (${img.mediaType} — \`pastels path ${img.label}\`)\n\n`);
      continue;
    }
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
