import type { Session, SessionInfo } from "../adapters/types";
import { humanAge, style, truncate } from "../util/format";
import { type Caps, enableTmuxPassthrough } from "./capability";
import { buildImageSequences, deleteByIdSeq, wrap } from "./kitty";

// Interactive session picker: an alt-screen list with arrow-key navigation,
// type-to-filter search, and (when the terminal supports kitty graphics) a live
// thumbnail of the highlighted session's first image on the right.
//
// Graphics inside an interactive loop means teardown MUST be bulletproof: the
// preview placement is deleted on every exit path AND on SIGINT/SIGTERM, never
// leaving a stranded graphic. Image transmits are debounced so fast scrolling
// over SSH doesn't flood the wire.

export interface PickRow {
  s: Session;
  info: SessionInfo;
}

export interface PickOptions {
  showRepo?: boolean;
  caps?: Caps;
  /** first renderable (PNG) image bytes for a session, or null — caller caches */
  preview?: (s: Session) => Buffer | null;
}

/** Filter rows by a case-insensitive substring match on branch, title, or cwd. */
export function filterRows(rows: PickRow[], query: string): PickRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      (r.info.gitBranch ?? "").toLowerCase().includes(q) ||
      r.info.title.toLowerCase().includes(q) ||
      (r.info.cwd ?? "").toLowerCase().includes(q)
  );
}

function rowText(
  r: PickRow,
  branchW: number,
  showRepo: boolean,
  maxWidth?: number
): string {
  const branchPad = truncate(r.info.gitBranch ?? "—", 26).padEnd(branchW);
  const count = `${r.info.imageCount} img`.padStart(7);
  const age = humanAge(r.info.startedAt).padEnd(9);
  const prefix = `${branchPad}  ${count}  ${age}  `;
  let title = r.info.title;
  let repo = showRepo && r.info.cwd ? `  · ${basename(r.info.cwd)}` : "";
  if (maxWidth) {
    const avail = maxWidth - prefix.length;
    title = avail > 1 ? truncate(title, avail) : "";
    repo = ""; // no room for repo when a preview pane is present
  }
  return (
    style.cyan(branchPad) +
    "  " +
    style.dim(count) +
    "  " +
    style.dim(age) +
    "  " +
    title +
    style.dim(repo)
  );
}

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

const VIEWPORT = 14;
const PREVIEW_ID = 777;

export function interactivePick(
  rows: PickRow[],
  opts: PickOptions = {}
): Promise<Session | null> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const branchW = Math.max(...rows.map((r) => truncate(r.info.gitBranch ?? "—", 26).length), 6);
  const showRepo = !!opts.showRepo;

  const cols = stdout.columns ?? 100;
  const rowsTotal = stdout.rows ?? 24;
  const graphics = !!(opts.caps?.graphics && opts.caps?.isTTY && opts.preview);
  const inTmux = !!opts.caps?.inTmux;
  const previewCol = graphics ? Math.max(44, Math.floor(cols * 0.5)) : 0;
  const leftWidth = graphics ? previewCol - 3 : undefined;
  const previewRows = Math.min(Math.max(6, rowsTotal - 5), 20);

  if (graphics && inTmux) enableTmuxPassthrough();

  return new Promise<Session | null>((resolve) => {
    let query = "";
    let sel = 0;
    let filtered = rows;
    let placed = false;
    let previewTimer: NodeJS.Timeout | undefined;

    const deletePreview = (): void => {
      if (placed) {
        stdout.write(wrap(deleteByIdSeq(PREVIEW_ID), inTmux));
        placed = false;
      }
    };

    const renderText = (): void => {
      filtered = filterRows(rows, query);
      if (sel >= filtered.length) sel = Math.max(0, filtered.length - 1);

      const lines: string[] = [];
      lines.push(style.dim("↑/↓ move · type to filter · enter open · esc quit"));
      lines.push("");

      const start = Math.min(
        Math.max(0, sel - Math.floor(VIEWPORT / 2)),
        Math.max(0, filtered.length - VIEWPORT)
      );
      filtered.slice(start, start + VIEWPORT).forEach((r, i) => {
        const real = start + i;
        const text = rowText(r, branchW, showRepo, leftWidth);
        if (real === sel) lines.push(style.cyan("❯ ") + `\x1b[7m ${text} \x1b[0m`);
        else lines.push("    " + text);
      });
      if (filtered.length === 0) lines.push(style.dim("    (no matches)"));

      lines.push("");
      lines.push(
        style.dim("filter: ") +
          (query ? style.bold(query) : style.dim("(all)")) +
          style.dim(`   ${filtered.length}/${rows.length}`)
      );

      stdout.write("\x1b[H\x1b[2J" + lines.join("\r\n"));
    };

    const renderPreview = (): void => {
      if (!graphics) return;
      deletePreview();
      const row = filtered[sel];
      stdout.write(`\x1b[2;${previewCol}H`); // move to preview region
      const bytes = row ? opts.preview!(row.s) : null;
      if (!bytes) {
        stdout.write(style.dim("(no preview)"));
        return;
      }
      for (const seq of buildImageSequences(bytes, { id: PREVIEW_ID, rows: previewRows })) {
        stdout.write(wrap(seq, inTmux));
      }
      placed = true;
    };

    const schedulePreview = (): void => {
      if (!graphics) return;
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(renderPreview, 110); // debounce transmits while scrolling
    };

    let torn = false;
    const teardown = (): void => {
      if (torn) return;
      torn = true;
      if (previewTimer) clearTimeout(previewTimer);
      deletePreview();
      stdin.off("data", onData);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      try {
        stdin.setRawMode(false);
      } catch {
        // ignore
      }
      stdin.pause();
      stdout.write("\x1b[?25h\x1b[?1049l"); // show cursor, leave alt-screen
    };

    const onSignal = (): void => {
      teardown();
      process.exit(130);
    };

    const done = (session: Session | null): void => {
      teardown();
      resolve(session);
    };

    const onData = (d: Buffer): void => {
      const s = d.toString("latin1");
      if (s === "\x03" || s === "\x1b") return done(null);
      if (s === "\r" || s === "\n") return done(filtered[sel]?.s ?? null);
      if (s === "\x1b[A") {
        sel = Math.max(0, sel - 1);
        renderText();
        return schedulePreview();
      }
      if (s === "\x1b[B") {
        sel = Math.min(filtered.length - 1, sel + 1);
        renderText();
        return schedulePreview();
      }
      if (s === "\x7f" || s === "\b") {
        query = query.slice(0, -1);
        sel = 0;
        renderText();
        return schedulePreview();
      }
      if (s.length === 1 && s >= " " && s <= "~") {
        query += s;
        sel = 0;
        renderText();
        return schedulePreview();
      }
    };

    stdout.write("\x1b[?1049h\x1b[?25l"); // alt-screen, hide cursor
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    try {
      stdin.setRawMode(true);
    } catch {
      // ignore
    }
    stdin.resume();
    stdin.on("data", onData);
    renderText();
    renderPreview(); // first preview immediately
  });
}
