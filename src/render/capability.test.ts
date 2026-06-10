import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectCaps, envGraphicsHeuristic } from "./capability";

const GRAPHICS_ENV = [
  "TERM",
  "TERM_PROGRAM",
  "KITTY_WINDOW_ID",
  "GHOSTTY_RESOURCES_DIR",
  "PASTELS_FORCE_GRAPHICS",
  "PASTELS_NO_GRAPHICS",
  "TMUX",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of GRAPHICS_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of GRAPHICS_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("envGraphicsHeuristic", () => {
  it("recognises ghostty/kitty terminals", () => {
    process.env.TERM = "xterm-ghostty";
    expect(envGraphicsHeuristic()).toBe(true);
    process.env.TERM = "xterm-kitty";
    expect(envGraphicsHeuristic()).toBe(true);
  });
  it("does not recognise tmux-256color (the SSH+tmux trap)", () => {
    process.env.TERM = "tmux-256color";
    expect(envGraphicsHeuristic()).toBe(false);
  });
});

describe("detectCaps overrides", () => {
  it("PASTELS_NO_GRAPHICS forces text-only", async () => {
    process.env.PASTELS_NO_GRAPHICS = "1";
    process.env.TERM = "xterm-ghostty";
    expect((await detectCaps()).graphics).toBe(false);
  });

  it("PASTELS_FORCE_GRAPHICS forces graphics on", async () => {
    process.env.PASTELS_FORCE_GRAPHICS = "1";
    process.env.TERM = "tmux-256color";
    expect((await detectCaps()).graphics).toBe(true);
  });

  it("without TTY, probing yields no graphics (vitest has no TTY)", async () => {
    process.env.TERM = "tmux-256color";
    expect((await detectCaps({ probe: true })).graphics).toBe(false);
  });

  it("reports tmux state from $TMUX", async () => {
    process.env.TMUX = "/tmp/tmux-1000/default,123,0";
    expect((await detectCaps()).inTmux).toBe(true);
  });
});
