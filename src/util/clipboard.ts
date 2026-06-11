import { spawnSync } from "node:child_process";
import { enableTmuxPassthrough } from "../render/capability";
import { tmuxWrap } from "../render/kitty";

// Copy text to the clipboard. Over SSH the system clipboard is on the *remote*
// box (or absent on a headless server), which is useless — what you want is your
// LOCAL terminal's clipboard. OSC 52 does exactly that: it asks the terminal
// (ghostty on your Mac) to set its clipboard, and the escape travels back over
// the SSH PTY. Under tmux it goes through the same passthrough envelope as the
// graphics. We prefer OSC 52 whenever stdout is a TTY; only without a TTY (pipes)
// do we fall back to local clipboard tools.

const TOOLS: string[][] =
  process.platform === "darwin"
    ? [["pbcopy"]]
    : [
        ["wl-copy"],
        ["xclip", "-selection", "clipboard"],
        ["xsel", "--clipboard", "--input"],
      ];

function osc52(text: string): void {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  let seq = `\x1b]52;c;${b64}\x07`;
  if (process.env.TMUX) {
    enableTmuxPassthrough(); // the wrapped sequence needs passthrough on
    seq = tmuxWrap(seq);
  }
  process.stdout.write(seq);
}

export function copyToClipboard(text: string): boolean {
  if (process.stdout.isTTY) {
    // OSC 52 → the local terminal's clipboard (works over SSH and in tmux).
    // No ack is possible, but for short text like a path this is reliable.
    osc52(text);
    return true;
  }
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
