#!/usr/bin/env node
import { ClaudeCodeTranscriptAdapter, slugForCwd } from "./adapters/claude-code";
import type { CaptureAdapter, Session } from "./adapters/types";
import { isRenderable } from "./core/png";
import { gc, ingest, type StoredImage } from "./core/store";
import { detectCaps } from "./render/capability";
import { printGallery } from "./render/gallery";
import { deleteAllSeq, wrap } from "./render/kitty";
import { show } from "./render/show";
import { humanDims, humanSize } from "./util/format";

const USAGE = `pastels — see what you pasted

usage:
  pastels                text gallery of images in the current session
  pastels -a             every image in this project, grouped by session
  pastels show N         full-screen render of [Image #N] (works in tmux)
  pastels -s             pick a session, then show its gallery
  pastels path N         print the stored file path for [Image #N]
  pastels gc [--days 7]  prune images not seen in N days
  pastels clear          panic: delete any stranded terminal graphics

  -h, --help             this help
  -v, --version          print version
`;

const VERSION = "0.0.1";

function adapter(): CaptureAdapter {
  return new ClaudeCodeTranscriptAdapter();
}

/** Load + persist the active session's images, sorted by label. */
function loadImages(session: Session, a: CaptureAdapter): StoredImage[] {
  const captured = a.extractImages(session);
  const stored = ingest(captured, `${a.name}:${session.id}`);
  return stored.sort((x, y) => x.label - y.label);
}

/** Pick the default session: most-recent session in the current project that has
 * images; else the most-recent session anywhere with images. */
function defaultSession(a: CaptureAdapter): { session: Session; images: StoredImage[] } | null {
  const slug = slugForCwd(process.cwd());
  const all = a.listSessions();
  const ordered = [
    ...all.filter((s) => s.project === slug),
    ...all.filter((s) => s.project !== slug),
  ];
  for (const s of ordered) {
    const images = loadImages(s, a);
    if (images.length > 0) return { session: s, images };
  }
  return null;
}

function findImage(images: StoredImage[], n: number): StoredImage | undefined {
  // prefer a certain (authoritative) label match over an inferred one
  const matches = images.filter((i) => i.label === n);
  return matches.find((i) => !i.uncertain) ?? matches[0];
}

async function pickSession(a: CaptureAdapter): Promise<Session | null> {
  const slug = slugForCwd(process.cwd());
  const all = a.listSessions();
  const list = (all.filter((s) => s.project === slug).length
    ? all.filter((s) => s.project === slug)
    : all
  ).slice(0, 20);

  if (list.length === 0) {
    console.error("no sessions found.");
    return null;
  }

  list.forEach((s, i) => {
    const count = a.extractImages(s).length;
    console.log(
      `  ${String(i + 1).padStart(2)}.  ${s.id}  ·  ${count} image${count === 1 ? "" : "s"}`
    );
  });
  process.stdout.write("\nselect a session [1]: ");

  const answer = await readLine();
  const idx = answer.trim() === "" ? 0 : Number(answer.trim()) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) {
    console.error("invalid selection.");
    return null;
  }
  return list[idx]!;
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      resolve("");
      return;
    }
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.once("data", (d: string) => {
      stdin.pause();
      resolve(d);
    });
  });
}

const PROJECT_SCAN_CAP = 25;

/** Scan the current project: pick the most-recent session with images as active,
 * and count how many of the project's sessions have images (for the browse hint).
 * Falls back to the most-recent session anywhere when the cwd isn't a known project. */
function projectScan(
  a: CaptureAdapter
): { active: Session; images: StoredImage[]; withImages: number; inProject: boolean } | null {
  const slug = slugForCwd(process.cwd());
  const all = a.listSessions();
  const proj = all.filter((s) => s.project === slug);

  if (proj.length) {
    let active: Session | undefined;
    let images: StoredImage[] = [];
    let withImages = 0;
    for (const s of proj.slice(0, PROJECT_SCAN_CAP)) {
      const imgs = loadImages(s, a);
      if (imgs.length) {
        withImages++;
        if (!active) {
          active = s;
          images = imgs;
        }
      }
    }
    if (active) return { active, images, withImages, inProject: true };
    return null;
  }

  for (const s of all) {
    const imgs = loadImages(s, a);
    if (imgs.length) return { active: s, images: imgs, withImages: 1, inProject: false };
  }
  return null;
}

async function cmdGallery(session?: Session): Promise<void> {
  const a = adapter();
  const caps = detectCaps();

  if (session) {
    printGallery(loadImages(session, a), caps, session);
    gc(7);
    return;
  }

  const r = projectScan(a);
  if (!r) {
    console.log("no images found. paste an image into a Claude Code session, then try again.");
    return;
  }

  printGallery(r.images, caps, r.active);
  if (r.inProject && r.withImages > 1) {
    const others = r.withImages - 1;
    process.stdout.write(
      `\n  ${others} other session${others === 1 ? "" : "s"} in this project ${
        others === 1 ? "has" : "have"
      } images — \`pastels -s\` to browse one, \`pastels -a\` for all.\n`
    );
  }
  // opportunistic, silent housekeeping (PRD §5.3) — by file mtime, never the
  // image you just viewed.
  gc(7);
}

/** `pastels -a` — every image in the current project, grouped by session. */
function cmdAll(): void {
  const a = adapter();
  const caps = detectCaps();
  const slug = slugForCwd(process.cwd());
  const proj = a.listSessions().filter((s) => s.project === slug);

  let any = false;
  for (const s of proj) {
    const imgs = loadImages(s, a);
    if (!imgs.length) continue;
    if (any) process.stdout.write("\n");
    printGallery(imgs, caps, s);
    any = true;
  }
  if (!any) console.log("no images found in this project.");
  gc(7);
}

async function cmdShow(arg: string | undefined, session?: Session): Promise<void> {
  const n = Number(arg);
  if (!arg || !Number.isInteger(n)) {
    console.error("usage: pastels show N");
    process.exitCode = 1;
    return;
  }
  const a = adapter();
  const caps = detectCaps();
  const ctx = session ? { session, images: loadImages(session, a) } : defaultSession(a);
  if (!ctx) {
    console.error("no images found.");
    process.exitCode = 1;
    return;
  }
  const img = findImage(ctx.images, n);
  if (!img) {
    console.error(`no [Image #${n}] in this session.`);
    process.exitCode = 1;
    return;
  }

  // graphics unsupported, or a format kitty can't paint (only PNG, no decoder):
  // degrade to a text line + path (PRD §5.4 item 4) rather than emit broken escapes.
  if (!caps.graphics || !caps.isTTY || !isRenderable(img.mediaType)) {
    if (caps.graphics && caps.isTTY && !isRenderable(img.mediaType)) {
      console.log(`[Image #${img.label}] is ${img.mediaType} — v0 renders PNG only.`);
    }
    console.log(
      `[Image #${img.label}]  ${humanDims(img.width, img.height)}  ${humanSize(img.bytes)}`
    );
    console.log(img.file);
    return;
  }
  await show(img, caps);
}

async function cmdPath(arg: string | undefined, session?: Session): Promise<void> {
  const n = Number(arg);
  if (!arg || !Number.isInteger(n)) {
    console.error("usage: pastels path N");
    process.exitCode = 1;
    return;
  }
  const a = adapter();
  const ctx = session ? { session, images: loadImages(session, a) } : defaultSession(a);
  if (!ctx) {
    console.error("no images found.");
    process.exitCode = 1;
    return;
  }
  const img = findImage(ctx.images, n);
  if (!img) {
    console.error(`no [Image #${n}] in this session.`);
    process.exitCode = 1;
    return;
  }
  console.log(img.file);
}

function cmdGc(args: string[]): void {
  let days = 7;
  const i = args.indexOf("--days");
  if (i !== -1 && args[i + 1] !== undefined) {
    const d = Number(args[i + 1]);
    if (Number.isFinite(d) && d >= 0) days = d;
  }
  const { filesDeleted, entriesPruned } = gc(days);
  console.log(
    `gc: removed ${filesDeleted} image${filesDeleted === 1 ? "" : "s"} older than ${days}d, pruned ${entriesPruned} index entr${entriesPruned === 1 ? "y" : "ies"}.`
  );
}

function cmdClear(): void {
  const caps = detectCaps();
  // panic delete-all, tmux-wrapped if needed, then restore the cursor.
  process.stdout.write(wrap(deleteAllSeq(), caps.inTmux));
  process.stdout.write("\x1b[?25h");
  console.error("cleared terminal graphics.");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // a leading -s / --session selects a session, then the remaining args run as usual
  let session: Session | undefined;
  if (argv[0] === "-s" || argv[0] === "--session") {
    argv.shift();
    const picked = await pickSession(adapter());
    if (!picked) {
      process.exitCode = 1;
      return;
    }
    session = picked;
  }

  const cmd = argv[0];
  switch (cmd) {
    case undefined:
      await cmdGallery(session);
      break;
    case "-a":
    case "--all":
    case "all":
      cmdAll();
      break;
    case "show":
      await cmdShow(argv[1], session);
      break;
    case "path":
      await cmdPath(argv[1], session);
      break;
    case "gc":
      cmdGc(argv.slice(1));
      break;
    case "clear":
      cmdClear();
      break;
    case "-h":
    case "--help":
    case "help":
      process.stdout.write(USAGE);
      break;
    case "-v":
    case "--version":
      console.log(VERSION);
      break;
    default:
      console.error(`unknown command: ${cmd}\n`);
      process.stdout.write(USAGE);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("pastels:", err?.message ?? err);
  process.exit(1);
});
