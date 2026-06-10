// Terminal capability detection (PRD §5.4 item 4). Never emit raw graphics
// escapes at a terminal that can't render them — fall back to the text table.

export interface Caps {
  /** running inside tmux ($TMUX set) — graphics must be envelope-wrapped */
  inTmux: boolean;
  /** terminal is believed to support the kitty graphics protocol */
  graphics: boolean;
  /** stdout is a TTY */
  isTTY: boolean;
}

export function detectCaps(): Caps {
  const inTmux = !!process.env.TMUX;
  const isTTY = !!process.stdout.isTTY;

  // Heuristic: kitty graphics is supported by kitty, ghostty, wezterm, konsole.
  // A query/response probe is more precise but risky over flaky SSH/tmux; the
  // text table is always a safe fallback, so a conservative env heuristic is fine.
  const term = process.env.TERM ?? "";
  const termProgram = process.env.TERM_PROGRAM ?? "";
  const graphics =
    !!process.env.KITTY_WINDOW_ID ||
    !!process.env.GHOSTTY_RESOURCES_DIR ||
    /kitty|ghostty/i.test(term) ||
    /ghostty|kitty|wezterm/i.test(termProgram);

  return { inTmux, graphics, isTTY };
}
