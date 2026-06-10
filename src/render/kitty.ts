// Kitty graphics protocol encoder + tmux passthrough envelope (PRD §5.4).
//
// A kitty command is: ESC _G <control-data> ; <payload> ESC \
// PNG data is transmitted with f=100, base64, chunked at 4096 bytes (m=1 more,
// m=0 last). We always set an explicit image id (i=) so teardown can delete
// exactly our placement — a stranded graphic must never leak (PRD §5.4 hard req).

const ESC = "\x1b";
const CHUNK = 4096;

/**
 * tmux swallows raw escapes; passthrough requires wrapping the WHOLE sequence in
 * ESC Ptmux; ... ESC \ with every inner ESC doubled. Only graphics sequences get
 * wrapped — alt-screen / clear control sequences must NOT be (PRD §5.4 item 2).
 */
export function tmuxWrap(seq: string): string {
  return ESC + "Ptmux;" + seq.replace(/\x1b/g, ESC + ESC) + ESC + "\\";
}

export function wrap(seq: string, inTmux: boolean): string {
  return inTmux ? tmuxWrap(seq) : seq;
}

export interface ImageOpts {
  /** explicit kitty image id, required for clean teardown */
  id: number;
  /** scale placement into this many terminal columns (optional) */
  cols?: number;
  /** scale placement into this many terminal rows (optional) */
  rows?: number;
}

/**
 * Build the (possibly chunked) transmit-and-display sequences for a PNG.
 * Returned sequences are raw (not tmux-wrapped) — wrap each at emit time.
 * If only one of rows/cols is given, kitty preserves aspect ratio for the other.
 */
export function buildImageSequences(png: Buffer, opts: ImageOpts): string[] {
  const b64 = png.toString("base64");
  const pieces: string[] = [];
  for (let i = 0; i < b64.length; i += CHUNK) pieces.push(b64.slice(i, i + CHUNK));
  if (pieces.length === 0) pieces.push("");

  return pieces.map((piece, idx) => {
    const more = idx < pieces.length - 1 ? 1 : 0;
    let controls: string;
    if (idx === 0) {
      const parts = ["a=T", "f=100", `i=${opts.id}`, "q=2"];
      if (opts.cols) parts.push(`c=${opts.cols}`);
      if (opts.rows) parts.push(`r=${opts.rows}`);
      parts.push(`m=${more}`);
      controls = parts.join(",");
    } else {
      controls = `m=${more}`;
    }
    return `${ESC}_G${controls};${piece}${ESC}\\`;
  });
}

/** Delete exactly the placement with image id `id` (used on `show N` exit). */
export function deleteByIdSeq(id: number): string {
  return `${ESC}_Ga=d,d=i,i=${id}${ESC}\\`;
}

/** Delete ALL kitty graphics — the `pastels clear` panic command. */
export function deleteAllSeq(): string {
  return `${ESC}_Ga=d,d=a${ESC}\\`;
}

/** Derive a small, stable, positive image id from a content hash. */
export function imageIdFromHash(hash: string): number {
  const n = parseInt(hash.slice(0, 6), 16);
  return (Number.isFinite(n) ? n % 2_000_000_000 : 1) + 1;
}
