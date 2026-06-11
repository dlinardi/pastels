import { spawnSync } from "node:child_process";

// Copy text to the system clipboard using whatever tool is present. Best-effort,
// zero-dep: pbcopy (macOS), wl-copy / xclip / xsel (Linux/Wayland/X11).
const TOOLS: string[][] =
  process.platform === "darwin"
    ? [["pbcopy"]]
    : [
        ["wl-copy"],
        ["xclip", "-selection", "clipboard"],
        ["xsel", "--clipboard", "--input"],
      ];

export function copyToClipboard(text: string): boolean {
  for (const [cmd, ...args] of TOOLS) {
    try {
      const r = spawnSync(cmd!, args, {
        input: text,
        stdio: ["pipe", "ignore", "ignore"],
      });
      if (!r.error && (r.status === 0 || r.status === null)) return true;
    } catch {
      // try the next tool
    }
  }
  return false;
}
