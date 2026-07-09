import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { tmuxWrap } from "../render/kitty";
import { enableTmuxPassthrough } from "../render/capability";
import { copyToClipboard } from "./clipboard";

// spawnSync is mocked so the non-TTY fallback never launches a real clipboard
// tool. enableTmuxPassthrough is stubbed so the TMUX branch doesn't shell out to
// a real `tmux` binary; tmuxWrap stays real so we can assert the exact envelope.
vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
vi.mock("../render/capability", async (orig) => ({
  ...(await orig<typeof import("../render/capability")>()),
  enableTmuxPassthrough: vi.fn(),
}));

const spawnMock = vi.mocked(spawnSync);
const passthroughMock = vi.mocked(enableTmuxPassthrough);

// Number of fallback tools tried on this platform (see TOOLS in clipboard.ts).
const TOOL_COUNT = process.platform === "darwin" ? 1 : 3;

let writes: string[];
let savedIsTTY: boolean | undefined;
let savedTmux: string | undefined;

beforeEach(() => {
  writes = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });
  savedIsTTY = process.stdout.isTTY;
  savedTmux = process.env.TMUX;
  delete process.env.TMUX;
  spawnMock.mockReset();
  passthroughMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, "isTTY", {
    value: savedIsTTY,
    configurable: true,
  });
  if (savedTmux === undefined) delete process.env.TMUX;
  else process.env.TMUX = savedTmux;
});

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", {
    value,
    configurable: true,
  });
}

describe("copyToClipboard — TTY (OSC 52)", () => {
  it("emits a raw OSC 52 sequence with base64 payload and returns true", () => {
    setTTY(true);
    const text = "/home/dave/.pastels/ab12.png";
    const ok = copyToClipboard(text);

    expect(ok).toBe(true);
    const b64 = Buffer.from(text, "utf8").toString("base64");
    expect(writes).toEqual([`\x1b]52;c;${b64}\x07`]);
    // no subprocess, no tmux passthrough when not in tmux
    expect(spawnMock).not.toHaveBeenCalled();
    expect(passthroughMock).not.toHaveBeenCalled();
  });

  it("wraps the sequence in the tmux passthrough envelope under $TMUX", () => {
    setTTY(true);
    process.env.TMUX = "/tmp/tmux-1000/default,1,0";
    const text = "hi";
    const ok = copyToClipboard(text);

    expect(ok).toBe(true);
    const b64 = Buffer.from(text, "utf8").toString("base64");
    const inner = `\x1b]52;c;${b64}\x07`;
    expect(writes).toEqual([tmuxWrap(inner)]);
    // the wrapped sequence needs passthrough enabled first
    expect(passthroughMock).toHaveBeenCalledTimes(1);
    // envelope doubles every ESC — sanity-check the wrapping happened
    expect(writes[0]).toContain("\x1bPtmux;");
    expect(writes[0]).not.toBe(inner);
  });

  it("base64-encodes multibyte (UTF-8) text correctly", () => {
    setTTY(true);
    const text = "café/☕.png";
    const ok = copyToClipboard(text);

    expect(ok).toBe(true);
    const b64 = Buffer.from(text, "utf8").toString("base64");
    expect(writes[0]).toBe(`\x1b]52;c;${b64}\x07`);
  });
});

describe("copyToClipboard — no TTY (spawn fallback)", () => {
  beforeEach(() => setTTY(false));

  it("returns true and feeds the text to the first tool that succeeds", () => {
    spawnMock.mockReturnValueOnce({ status: 0 } as ReturnType<typeof spawnSync>);
    const ok = copyToClipboard("/path/to.png");

    expect(ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, , options] = spawnMock.mock.calls[0]!;
    expect(options).toMatchObject({ input: "/path/to.png" });
    // OSC 52 path is not taken without a TTY
    expect(writes).toEqual([]);
  });

  it("treats a null exit status (no explicit code) as success", () => {
    spawnMock.mockReturnValueOnce({ status: null } as ReturnType<typeof spawnSync>);
    expect(copyToClipboard("x")).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("advances past a failed tool to the next one", () => {
    if (TOOL_COUNT < 2) return; // darwin only has pbcopy; nothing to advance to
    spawnMock
      .mockReturnValueOnce({ error: new Error("ENOENT") } as ReturnType<typeof spawnSync>)
      .mockReturnValueOnce({ status: 0 } as ReturnType<typeof spawnSync>);
    expect(copyToClipboard("x")).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("returns false when every tool errors", () => {
    spawnMock.mockReturnValue({ error: new Error("ENOENT") } as ReturnType<typeof spawnSync>);
    expect(copyToClipboard("x")).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(TOOL_COUNT);
  });

  it("returns false when a tool exits non-zero", () => {
    spawnMock.mockReturnValue({ status: 1 } as ReturnType<typeof spawnSync>);
    expect(copyToClipboard("x")).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(TOOL_COUNT);
  });

  it("survives a tool that throws and keeps trying the rest", () => {
    spawnMock.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(copyToClipboard("x")).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(TOOL_COUNT);
  });
});
