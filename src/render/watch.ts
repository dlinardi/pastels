import fs from "node:fs";
import path from "node:path";
import type { CaptureAdapter, Session } from "../adapters/types";
import { isRenderable } from "../core/png";
import { ingest, type StoredImage } from "../core/store";
import { humanDims, humanSize, style } from "../util/format";
import { type Caps, enableTmuxPassthrough } from "./capability";
import { buildImageSequences, deleteByIdSeq, imageIdFromHash, wrap } from "./kitty";

// `pastels watch` — resident auto-preview (PRD phase 4, the real version of "see
// the image as I'm composing"). Run it in a dedicated pane/window. It tails the
// current project's active session and repaints each newly pasted image in its
// OWN surface — on PASTE, before you submit, via Claude Code's image-cache
// (adapter.liveImages); it falls back to the submitted transcript when no cache
// exists. Either way the image appears the moment it is available.
//
// WHY ITS OWN SURFACE: positioned inline graphics desync under tmux (the
// load-bearing phase-0 finding). watch never paints over Claude Code; it owns
// the pane it lives in and uses the same full-pane / home-placement path as
// `show`, so it behaves identically in and out of tmux. Single slot: always the
// latest paste, replacing the previous (no scrolling feed, which is inline-only).
//
// TEARDOWN IS NON-NEGOTIABLE (PRD §5.4) and the stakes are higher here than in
// `show` because the placement is resident for hours: explicit kitty delete on
// EVERY exit path, plus SIGINT/SIGTERM/SIGHUP handlers. `pastels clear` remains
// the panic command for a SIGKILL strand.

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const CLEAR_HOME = "\x1b[2J\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

// fs.watch is the instant trigger; the poll is the correctness floor (watchers
// drop/coalesce events and vary by platform, and we already hit flaky timing
// over SSH). The poll is brisk because paste-to-pixels should feel immediate.
// Debounce coalesces the event burst a paste write produces and lets a
// half-written PNG finish flushing before we read it.
const DEFAULT_POLL_MS = 700;
const DEBOUNCE_MS = 150;

/**
 * The most recently pasted image to surface, by document-appearance order. In
 * graphics mode only renderable (PNG) images count, since kitty can't paint the
 * rest; in text mode any image counts (we print its path). undefined for none.
 */
export function pickLatest(
  images: StoredImage[],
  requireRenderable: boolean
): StoredImage | undefined {
  const pool = requireRenderable
    ? images.filter((i) => isRenderable(i.mediaType))
    : images;
  if (pool.length === 0) return undefined;
  return pool.reduce((a, b) => (b.appearance >= a.appearance ? b : a));
}

/**
 * The active session in `slug`'s project: the newest-mtime transcript. Strictly
 * project-scoped — never another project's session, so watch can't surface a
 * different repo's image. listSessions() is already mtime-desc, so the first
 * entry that belongs to the project is the active one.
 */
export function activeSession(a: CaptureAdapter, slug: string): Session | null {
  return a.listSessions().find((s) => s.project === slug) ?? null;
}

export interface WatchOptions {
  plain?: boolean;
  pollMs?: number;
}

/**
 * Watch the current project for newly pasted images and auto-render the latest.
 * Resolves when the user quits (q / Ctrl-C); signal exits go through the same
 * teardown. `watchDirs` are the directories we fs.watch for instant triggers
 * (e.g. the image-cache and the project transcript dir); any that don't exist
 * yet are simply skipped — the poll picks them up when they appear.
 */
export async function watch(
  a: CaptureAdapter,
  slug: string,
  watchDirs: string[],
  caps: Caps,
  opts: WatchOptions = {},
  out: NodeJS.WriteStream = process.stdout
): Promise<void> {
  const graphics = caps.graphics && caps.isTTY;
  const usePlain = opts.plain || process.env.PASTELS_PLAIN_CLEAR === "1";
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const projectName = path.basename(process.cwd());

  if (caps.inTmux) enableTmuxPassthrough();

  let lastHash: string | null = null;
  let current: StoredImage | null = null;
  let placedId: number | null = null;

  const deletePlacement = (): void => {
    if (placedId !== null) {
      out.write(wrap(deleteByIdSeq(placedId), caps.inTmux));
      placedId = null;
    }
  };

  const paint = (img: StoredImage): void => {
    deletePlacement();
    out.write(CLEAR_HOME);
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(img.file);
    } catch {
      return; // file pruned mid-watch — skip, next paste repaints
    }
    const id = imageIdFromHash(img.hash);
    const termRows = out.rows && out.rows > 3 ? out.rows - 2 : undefined;
    for (const seq of buildImageSequences(bytes, { id, rows: termRows })) {
      out.write(wrap(seq, caps.inTmux));
    }
    placedId = id;

    const footer =
      `${style.green("● watching")} ${style.dim(projectName)}  ` +
      `[Image #${img.label}]${img.uncertain ? " (inferred)" : ""}  ` +
      `${humanDims(img.width, img.height)}${style.dim("   q quit")}`;
    if (out.rows) out.write(`\x1b[${out.rows};1H`);
    out.write("\x1b[2K" + footer);
  };

  const waiting = (): void => {
    if (!graphics) return;
    out.write(
      CLEAR_HOME +
        style.dim(
          `● watching ${projectName} — paste an image in Claude Code and it appears here.   q quit`
        )
    );
  };

  // Single scan: re-pick the active session, surface its latest image if it's
  // new since the last paint. Prefer paste-time images (liveImages) so we render
  // before submit; fall back to the submitted transcript. Never throws to the loop.
  const scan = (): void => {
    let session: Session | null;
    try {
      session = activeSession(a, slug);
    } catch {
      return;
    }
    if (!session) return;

    let images: StoredImage[];
    try {
      const live = a.liveImages ? a.liveImages(session) : [];
      const captured = live.length ? live : a.extractImages(session);
      images = ingest(captured, `${a.name}:${session.id}`);
    } catch {
      return;
    }
    const img = pickLatest(images, graphics);
    if (!img || img.hash === lastHash) return;
    // a freshly-pasted PNG can be caught mid-write (no IHDR yet → null dims);
    // skip this tick and let the next trigger repaint the complete file.
    if (graphics && img.width == null) return;
    lastHash = img.hash;
    current = img;

    if (graphics) {
      paint(img);
    } else {
      out.write(
        `[Image #${img.label}]${img.uncertain ? " ?" : ""}  ` +
          `${humanDims(img.width, img.height)}  ${humanSize(img.bytes)}  ${img.file}\n`
      );
    }
  };

  return new Promise<void>((resolve) => {
    const stdin = process.stdin;

    let debounceTimer: NodeJS.Timeout | undefined;
    const trigger = (): void => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
        scan();
      }, DEBOUNCE_MS);
    };

    // macOS fs.watch supports recursive (catches writes into the per-session
    // subdir); Linux does not (passing recursive:true would throw), so there the
    // top-level event + the poll cover nested paste writes.
    const recursive = process.platform === "darwin";
    const watchers: fs.FSWatcher[] = [];
    for (const dir of watchDirs) {
      try {
        watchers.push(fs.watch(dir, { persistent: true, recursive }, () => trigger()));
      } catch {
        // dir missing yet or fs.watch unsupported here — poll covers it
      }
    }
    const pollTimer = setInterval(trigger, pollMs);

    const onData = (d: Buffer): void => {
      const s = d.toString("latin1");
      if (s === "q" || s === "\x1b" || s === "\x03") finish();
    };

    let torn = false;
    const teardown = (): void => {
      if (torn) return;
      torn = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(pollTimer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
      stdin.off("data", onData);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      process.off("SIGHUP", onSignal);
      process.off("SIGWINCH", onWinch);
      if (graphics) {
        deletePlacement(); // must never leak
        out.write(usePlain ? CLEAR_HOME : LEAVE_ALT);
        out.write(SHOW_CURSOR);
      }
      try {
        stdin.setRawMode(false);
      } catch {
        // ignore
      }
      stdin.pause();
    };

    const finish = (): void => {
      teardown();
      resolve();
    };
    const onSignal = (): void => {
      teardown();
      process.exit(130);
    };
    const onWinch = (): void => {
      if (graphics && current) paint(current);
    };

    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    process.on("SIGHUP", onSignal);
    process.on("SIGWINCH", onWinch);

    if (graphics) {
      out.write(usePlain ? "" : ENTER_ALT);
      out.write(HIDE_CURSOR);
    }
    if (stdin.isTTY) {
      try {
        stdin.setRawMode(true);
      } catch {
        // ignore
      }
      stdin.resume();
      stdin.on("data", onData);
    }

    scan(); // initial frame: show the latest existing image, if any
    if (graphics && lastHash === null) waiting();
  });
}
