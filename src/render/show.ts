import fs from "node:fs";
import type { StoredImage } from "../core/store";
import { humanDims } from "../util/format";
import { type Caps, enableTmuxPassthrough } from "./capability";
import {
  buildImageSequences,
  deleteByIdSeq,
  imageIdFromHash,
  wrap,
} from "./kitty";

// `pastels show N` — full-pane takeover (PRD §5.4 item 1, the HERO command).
// Enter alt-screen, clear, paint ONE image, wait for a keypress, restore.
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

export async function show(
  img: StoredImage,
  caps: Caps,
  opts: ShowOptions = {},
  out: NodeJS.WriteStream = process.stdout
): Promise<void> {
  const usePlain = opts.plain || process.env.PASTELS_PLAIN_CLEAR === "1";
  const id = imageIdFromHash(img.hash);

  // graphics through tmux require passthrough; guarantee it before we emit any,
  // regardless of how capability detection resolved (e.g. PASTELS_FORCE_GRAPHICS).
  if (caps.inTmux) enableTmuxPassthrough();

  let torn = false;
  const teardown = (): void => {
    if (torn) return;
    torn = true;
    // 1) delete our graphic (tmux-wrapped if needed) — must never leak
    out.write(wrap(deleteByIdSeq(id), caps.inTmux));
    // 2) restore the screen (raw, never wrapped)
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
    out.write(usePlain ? CLEAR_HOME : ENTER_ALT + CLEAR_HOME);
    out.write(HIDE_CURSOR);

    const bytes = fs.readFileSync(img.file);
    // fit to height; kitty preserves aspect for width when only rows is given.
    const termRows = out.rows && out.rows > 3 ? out.rows - 2 : undefined;
    for (const seq of buildImageSequences(bytes, { id, rows: termRows })) {
      out.write(wrap(seq, caps.inTmux));
    }

    const footer = `[Image #${img.label}]${
      img.uncertain ? " (label inferred)" : ""
    }  ${humanDims(img.width, img.height)}   ·   press any key to return`;
    if (out.rows) out.write(`\x1b[${out.rows};1H`);
    out.write("\x1b[2K" + footer);

    await waitForKey();
  } finally {
    teardown();
    removeSignals();
  }
}

function waitForKey(): Promise<void> {
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
    const onData = (): void => finish();
    try {
      stdin.setRawMode(true);
    } catch {
      // ignore
    }
    stdin.resume();
    stdin.once("data", onData);
  });
}
