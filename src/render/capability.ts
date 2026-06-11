import { execFileSync } from "node:child_process";
import { tmuxWrap } from "./kitty";

// Terminal capability detection (PRD §5.4 item 4). Never emit raw graphics
// escapes at a terminal that can't render them — fall back to the text table.
//
// The hard case is the product's whole reason for existing: SSH + tmux. There,
// TERM becomes tmux-256color and the outer terminal's env vars (KITTY_WINDOW_ID,
// GHOSTTY_RESOURCES_DIR, TERM_PROGRAM) are NOT forwarded — so an env heuristic
// alone wrongly concludes "no graphics" and disables the hero command. So we
// also actively probe: send a kitty graphics *query* (a=q, renders nothing) plus
// a primary-device-attributes request as a sentinel, and see if the terminal
// answers the graphics query. This works through tmux once passthrough is on.

export interface Caps {
  /** running inside tmux ($TMUX set) — graphics must be envelope-wrapped */
  inTmux: boolean;
  /** terminal is believed to support the kitty graphics protocol */
  graphics: boolean;
  /** stdout is a TTY */
  isTTY: boolean;
}

/** Fast, side-effect-free guess from environment variables. */
export function envGraphicsHeuristic(): boolean {
  const term = process.env.TERM ?? "";
  const termProgram = process.env.TERM_PROGRAM ?? "";
  return (
    !!process.env.KITTY_WINDOW_ID ||
    !!process.env.GHOSTTY_RESOURCES_DIR ||
    /kitty|ghostty/i.test(term) ||
    /ghostty|kitty|wezterm/i.test(termProgram)
  );
}

/** Ask tmux to allow graphics passthrough (PRD §5.4: "check/set allow-passthrough"). */
export function enableTmuxPassthrough(): void {
  try {
    execFileSync("tmux", ["set", "-gq", "allow-passthrough", "on"], {
      stdio: "ignore",
      timeout: 1000,
    });
  } catch {
    // tmux missing or older — passthrough may already be on, or graphics won't work
  }
}

/**
 * Actively probe for kitty graphics support. Sends a graphics query (a=q paints
 * nothing) followed by a DA1 request, then reads the reply. A graphics-capable
 * terminal answers the query with `\x1b_Gi=31;OK`.
 *
 * Ordering matters and differs by environment: bare terminals answer the graphics
 * query *before* DA1, so DA1 is a valid "stop, it's unsupported" sentinel. Under
 * tmux the graphics query takes an extra passthrough hop while DA1 may be answered
 * by tmux itself — so DA1 can arrive FIRST. There we must NOT treat DA1 as a
 * sentinel; we keep reading until the graphics reply lands or we time out (and we
 * always drain briefly after deciding, so a late reply never echoes to the screen).
 */
export function probeKittyGraphics(
  inTmux: boolean,
  timeoutMs = inTmux ? 1200 : 400
): Promise<boolean> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) return Promise.resolve(false);

  // 1x1 RGB pixel, transmitted directly (f=24), query action (a=q) renders nothing
  const pixel = Buffer.from([0, 0, 0]).toString("base64");
  let query = `\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;${pixel}\x1b\\`;
  if (inTmux) query = tmuxWrap(query);
  const da1 = "\x1b[c";

  return new Promise<boolean>((resolve) => {
    let buf = "";
    let settled = false;
    let result = false;
    const prevRaw = stdin.isRaw;
    let hardTimer: NodeJS.Timeout;
    let drainTimer: NodeJS.Timeout | undefined;

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (drainTimer) clearTimeout(drainTimer);
      stdin.off("data", onData);
      try {
        stdin.setRawMode(prevRaw);
      } catch {
        // ignore
      }
      stdin.pause();
      resolve(result);
    };

    // record the verdict, but keep consuming input briefly so trailing replies
    // (e.g. a late DA1 answer) are swallowed instead of echoed to the screen.
    const decide = (val: boolean, drainMs: number): void => {
      result = val;
      if (drainTimer) clearTimeout(drainTimer);
      drainTimer = setTimeout(cleanup, drainMs);
    };

    const onData = (d: Buffer): void => {
      buf += d.toString("latin1");
      if (buf.includes("\x1b_Gi=31")) return decide(true, 120); // graphics OK reply
      if (!inTmux && /\x1b\[\?[0-9;]*c/.test(buf)) return decide(false, 30); // DA1 sentinel
    };

    try {
      stdin.setRawMode(true);
    } catch {
      // ignore
    }
    stdin.resume();
    stdin.on("data", onData);
    stdout.write(query + da1);
    hardTimer = setTimeout(() => {
      result = buf.includes("_Gi=31");
      cleanup();
    }, timeoutMs);
  });
}

export interface DetectOptions {
  /** actively probe the terminal when the env heuristic is inconclusive */
  probe?: boolean;
}

/**
 * Detect capabilities. Overrides: PASTELS_NO_GRAPHICS=1 forces text-only,
 * PASTELS_FORCE_GRAPHICS=1 forces graphics on (the guaranteed escape hatch when
 * a terminal supports kitty graphics but detection can't prove it).
 */
export async function detectCaps(opts: DetectOptions = {}): Promise<Caps> {
  const inTmux = !!process.env.TMUX;
  const isTTY = !!process.stdout.isTTY;

  if (process.env.PASTELS_NO_GRAPHICS === "1") return { inTmux, isTTY, graphics: false };
  if (process.env.PASTELS_FORCE_GRAPHICS === "1") return { inTmux, isTTY, graphics: true };

  if (envGraphicsHeuristic()) return { inTmux, isTTY, graphics: true };

  if (!opts.probe || !isTTY) return { inTmux, isTTY, graphics: false };

  if (inTmux) enableTmuxPassthrough();
  const graphics = await probeKittyGraphics(inTmux);
  return { inTmux, isTTY, graphics };
}
