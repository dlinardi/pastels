export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function humanAge(ts: string | undefined, now = Date.now()): string {
  if (!ts) return "—";
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return "—";
  const diff = Math.max(0, now - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function humanDims(w: number | null, h: number | null): string {
  if (w == null || h == null) return "?×?";
  return `${w}×${h}`;
}

// Minimal ANSI styling — only when stdout is a TTY and NO_COLOR is unset.
const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR;
const sgr = (code: string) => (s: string | number) =>
  useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s);

export const style = {
  dim: sgr("2"),
  bold: sgr("1"),
  cyan: sgr("36"),
  green: sgr("32"),
  yellow: sgr("33"),
};

/** Truncate plain text to a max length with an ellipsis. */
export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Visible width of a string, ignoring SGR escape sequences (for padding). */
export function visibleWidth(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Pad a (possibly styled) string to a visible width. */
export function padVisible(s: string, width: number): string {
  const pad = width - visibleWidth(s);
  return pad > 0 ? s + " ".repeat(pad) : s;
}
