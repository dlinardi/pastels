import path from "node:path";
import type { Session, SessionInfo } from "../adapters/types";
import { humanAge, padVisible, style, truncate } from "../util/format";

// Interactive session picker: an alt-screen list with arrow-key navigation and
// type-to-filter search. Falls back to a numbered prompt when there's no TTY
// (the caller decides). Arrow keys navigate; printable characters filter, so
// j/k are NOT navigation (they'd collide with typing a query).

export interface PickRow {
  s: Session;
  info: SessionInfo;
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

function rowText(r: PickRow, branchW: number, showRepo: boolean): string {
  const branch = padVisible(truncate(r.info.gitBranch ?? "—", 26), branchW);
  const count = `${r.info.imageCount} img`.padStart(7);
  const age = padVisible(humanAge(r.info.startedAt), 9);
  let t = `${branch}  ${count}  ${age}  ${r.info.title}`;
  if (showRepo && r.info.cwd) t += `  · ${path.basename(r.info.cwd)}`;
  return t;
}

const VIEWPORT = 15;

export function interactivePick(
  rows: PickRow[],
  opts: { showRepo?: boolean } = {}
): Promise<Session | null> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const branchW = Math.max(...rows.map((r) => truncate(r.info.gitBranch ?? "—", 26).length), 6);
  const showRepo = !!opts.showRepo;

  return new Promise<Session | null>((resolve) => {
    let query = "";
    let sel = 0;
    let filtered = rows;

    const render = (): void => {
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
        const text = rowText(r, branchW, showRepo);
        if (real === sel) lines.push(style.cyan("❯ ") + `\x1b[7m ${text} \x1b[0m`);
        else lines.push("    " + style.dim(text));
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

    const teardown = (): void => {
      stdin.off("data", onData);
      try {
        stdin.setRawMode(false);
      } catch {
        // ignore
      }
      stdin.pause();
      stdout.write("\x1b[?25h\x1b[?1049l"); // show cursor, leave alt-screen
    };

    const onData = (d: Buffer): void => {
      const s = d.toString("latin1");
      if (s === "\x03" || s === "\x1b") {
        teardown();
        resolve(null);
        return;
      }
      if (s === "\r" || s === "\n") {
        const chosen = filtered[sel] ?? null;
        teardown();
        resolve(chosen ? chosen.s : null);
        return;
      }
      if (s === "\x1b[A") {
        sel = Math.max(0, sel - 1);
        return render();
      }
      if (s === "\x1b[B") {
        sel = Math.min(filtered.length - 1, sel + 1);
        return render();
      }
      if (s === "\x7f" || s === "\b") {
        query = query.slice(0, -1);
        sel = 0;
        return render();
      }
      if (s.length === 1 && s >= " " && s <= "~") {
        query += s;
        sel = 0;
        return render();
      }
    };

    stdout.write("\x1b[?1049h\x1b[?25l"); // alt-screen, hide cursor
    try {
      stdin.setRawMode(true);
    } catch {
      // ignore
    }
    stdin.resume();
    stdin.on("data", onData);
    render();
  });
}
