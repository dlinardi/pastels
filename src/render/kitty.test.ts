import { describe, expect, it } from "vitest";
import {
  buildImageSequences,
  deleteAllSeq,
  deleteByIdSeq,
  imageIdFromHash,
  tmuxWrap,
  wrap,
} from "./kitty";

const ESC = "\x1b";

describe("tmuxWrap", () => {
  it("wraps in the passthrough envelope and doubles every ESC", () => {
    const seq = `${ESC}_Ga=T;AAAA${ESC}\\`;
    const wrapped = tmuxWrap(seq);
    expect(wrapped.startsWith(`${ESC}Ptmux;`)).toBe(true);
    expect(wrapped.endsWith(`${ESC}\\`)).toBe(true);
    // every inner ESC doubled: original had 2 ESC → envelope adds its own
    expect(wrapped).toContain(`${ESC}${ESC}_Ga=T;AAAA${ESC}${ESC}\\`);
  });

  it("wrap() is a no-op outside tmux", () => {
    const seq = `${ESC}_Ga=d${ESC}\\`;
    expect(wrap(seq, false)).toBe(seq);
    expect(wrap(seq, true)).toBe(tmuxWrap(seq));
  });
});

describe("buildImageSequences", () => {
  it("emits a single sequence for small payloads with the right controls", () => {
    const seqs = buildImageSequences(Buffer.from("hello"), { id: 7 });
    expect(seqs).toHaveLength(1);
    expect(seqs[0]).toContain("a=T");
    expect(seqs[0]).toContain("f=100");
    expect(seqs[0]).toContain("i=7");
    expect(seqs[0]).toContain("m=0");
    expect(seqs[0]!.startsWith(`${ESC}_G`)).toBe(true);
    expect(seqs[0]!.endsWith(`${ESC}\\`)).toBe(true);
  });

  it("chunks large payloads with m=1 then a final m=0", () => {
    const big = Buffer.alloc(7000, 0x41); // > 4096 base64 chars
    const seqs = buildImageSequences(big, { id: 1 });
    expect(seqs.length).toBeGreaterThan(1);
    expect(seqs[0]).toContain("m=1");
    expect(seqs[0]).toContain("a=T"); // controls only on first chunk
    expect(seqs[seqs.length - 1]).toContain("m=0");
    expect(seqs[1]).not.toContain("a=T");
  });

  it("includes scaling controls when rows/cols are given", () => {
    const seqs = buildImageSequences(Buffer.from("x"), { id: 2, rows: 6 });
    expect(seqs[0]).toContain("r=6");
  });
});

describe("delete sequences", () => {
  it("delete-by-id targets the placement", () => {
    expect(deleteByIdSeq(42)).toBe(`${ESC}_Ga=d,d=i,i=42${ESC}\\`);
  });
  it("delete-all is the panic sequence", () => {
    expect(deleteAllSeq()).toBe(`${ESC}_Ga=d,d=a${ESC}\\`);
  });
});

describe("imageIdFromHash", () => {
  it("is stable and positive", () => {
    expect(imageIdFromHash("abcdef0123")).toBe(imageIdFromHash("abcdef0123"));
    expect(imageIdFromHash("000000")).toBeGreaterThan(0);
  });
});
