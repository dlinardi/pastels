import fs from "node:fs";
import { isRenderable } from "../core/png";
import type { StoredImage } from "../core/store";
import { humanDims, style } from "../util/format";
import { type Caps, enableTmuxPassthrough } from "./capability";
import {
  buildImageSequences,
  deleteByIdSeq,
  imageIdFromHash,
  wrap,
} from "./kitty";

// `pastels show N` — full-pane takeover (PRD §5.4 item 1, the HERO command).
// Enter alt-screen, clear, paint an image, navigate with ←/→ between the
// session's images, restore on quit.
//
// TEARDOWN IS NON-NEGOTIABLE (PRD §5.4 hard req): an explicit kitty delete on
// every exit path AND SIGINT/SIGTERM handlers that delete the placement before
// exiting. A stranded graphic overlays the user's whole tmux session.
//
// Note: alt-screen / clear control sequences are emitted RAW (never tmux-wrapped);
// only the kitty graphics sequences go through wrap(). Set PASTELS_PLAIN_CLEAR=1
// (or pass plain:true) to fall back to the phase-0-proven plain-clear path if
// alt-screen misbehaves under tmux.

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const CLEAR_HOME = "\x1b[2J\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

export interface ShowOptions {
  plain?: boolean;
}

/**
 * Show image at `startIndex` from `images`, navigable with ←/→ (or n/p) across
 * the renderable (PNG) images in the list. q/Esc/Enter quits. Single image =
 * any-key-to-return, same as before.
 */
export async function show(
  images: StoredImage[],
  startIndex: number,
  caps: Caps,
  opts: ShowOptions = {},
  out: NodeJS.WriteStream = process.stdout
): Promise<void> {
  const usePlain = opts.plain || process.env.PASTELS_PLAIN_CLEAR === "1";

  // navigate only the renderable images; map the requested index onto them
  const renderable = images.filter((i) => isRenderable(i.mediaType));
  if (renderable.length === 0) return;
  const requested = images[startIndex];
  let cursor = Math.max(
    0,
    renderable.findIndex((i) => i.hash === requested?.hash)
  );

  // graphics through tmux require passthrough; guarantee it before we emit any,
  // regardless of how capability detection resolved (e.g. PASTELS_FORCE_GRAPHICS).
  if (caps.inTmux) enableTmuxPassthrough();

  let placedId: number | null = null;
  const deletePlacement = (): void => {
    if (placedId !== null) {
      out.write(wrap(deleteByIdSeq(placedId), caps.inTmux));
      placedId = null;
    }
  };

  const paint = (): void => {
    deletePlacement();
    out.write(CLEAR_HOME);
    const img = renderable[cursor]!;
    const id = imageIdFromHash(img.hash);
    const bytes = fs.readFileSync(img.file);
    const termRows = out.rows && out.rows > 3 ? out.rows - 2 : undefined;
    for (const seq of buildImageSequences(bytes, { id, rows: termRows })) {
      out.write(wrap(seq, caps.inTmux));
    }
    placedId = id;

    const pos =
      renderable.length > 1 ? `  ${cursor + 1}/${renderable.length}` : "";
    const nav = renderable.length > 1 ? style.dim("  ←/→ navigate · q quit") : style.dim("  press any key to return");
    const footer =
      `[Image #${img.label}]${img.uncertain ? " (label inferred)" : ""}  ` +
      `${humanDims(img.width, img.height)}${style.dim(pos)}${nav}`;
    if (out.rows) out.write(`\x1b[${out.rows};1H`);
    out.write("\x1b[2K" + footer);
  };

  let torn = false;
  const teardown = (): void => {
    if (torn) return;
    torn = true;
    deletePlacement(); // must never leak
    out.write(usePlain ? CLEAR_HOME : LEAVE_ALT);
    out.write(SHOW_CURSOR);
  };

  const onSignal = (): void => {
    teardown();
    removeSignals();
    process.exit(130);
  };
  const removeSignals = (): void => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    out.write(usePlain ? "" : ENTER_ALT);
    out.write(HIDE_CURSOR);
    paint();
    await navigate(renderable.length, {
      prev: () => {
        if (cursor > 0) {
          cursor--;
          paint();
        }
      },
      next: () => {
        if (cursor < renderable.length - 1) {
          cursor++;
          paint();
        }
      },
    });
  } finally {
    teardown();
    removeSignals();
  }
}

/** Read navigation keys until quit. Single image → any key quits. */
function navigate(
  count: number,
  handlers: { prev: () => void; next: () => void }
): Promise<void> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      resolve();
      return;
    }
    const finish = (): void => {
      stdin.off("data", onData);
      try {
        stdin.setRawMode(false);
      } catch {
        // ignore
      }
      stdin.pause();
      resolve();
    };
    const onData = (d: Buffer): void => {
      if (count <= 1) return finish(); // single image: any key returns
      const s = d.toString("latin1");
      if (s === "q" || s === "\x1b" || s === "\x03" || s === "\r" || s === "\n") {
        return finish();
      }
      if (s === "\x1b[D" || s === "p" || s === "k" || s === "h") return handlers.prev();
      if (s === "\x1b[C" || s === "n" || s === "j" || s === "l" || s === " ") {
        return handlers.next();
      }
    };
    try {
      stdin.setRawMode(true);
    } catch {
      // ignore
    }
    stdin.resume();
    stdin.on("data", onData);
  });
}
