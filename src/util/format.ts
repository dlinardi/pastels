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
