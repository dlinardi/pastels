#!/usr/bin/env node
import path from "node:path";
import {
  ClaudeCodeTranscriptAdapter,
  imageCacheDir,
  projectsDir,
  slugForCwd,
} from "./adapters/claude-code";
import type { CaptureAdapter, Session, SessionInfo } from "./adapters/types";
import { isRenderable } from "./core/png";
import { gc, ingest, type StoredImage } from "./core/store";
import { type Caps, detectCaps } from "./render/capability";
import { printGallery } from "./render/gallery";
import { deleteAllSeq, wrap } from "./render/kitty";
import { show } from "./render/show";
import { interactiveImagePick, interactivePick } from "./render/tui";
import { watch } from "./render/watch";
import { copyToClipboard } from "./util/clipboard";
import { humanAge, humanDims, humanSize, padVisible, style, truncate } from "./util/format";

const USAGE = `pastels — see what you pasted

usage:
  pastels                text gallery of images in the current session
  pastels -a             every image in this project, grouped by session
  pastels -A             index of image sessions across ALL projects
  pastels show N         full-screen render of [Image #N] (alias: pastels N)
  pastels -s             interactive picker (arrow keys + filter), then render
  pastels -s N           pick a session, then render [Image #N] from it
  pastels path N [--copy] print (and optionally clipboard-copy) the file path
  pastels watch          auto-render each newly pasted image (run in a spare pane)
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

/** Most-recent session in the CURRENT project (by cwd slug) that has images.
 * Strictly project-scoped — never crosses into another project's sessions, or
 * `pastels show N` from one repo could surface a different repo's image. Use
 * `pastels -s` to reach other projects' sessions. */
function defaultSession(a: CaptureAdapter): { session: Session; images: StoredImage[] } | null {
  const slug = slugForCwd(process.cwd());
  const proj = a.listSessions().filter((s) => s.project === slug);
  for (const s of proj) {
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

/** Print one formatted session row: lead · branch · N img · age · title (· repo). */
function printSessionRows(
  rows: { s: Session; info: SessionInfo }[],
  showRepo: boolean,
  numbered = true
): void {
  const branches = rows.map((r) => truncate(r.info.gitBranch ?? "—", 26));
  const branchW = Math.max(...branches.map((b) => b.length), 6);
  rows.forEach((r, i) => {
    const lead = numbered ? style.dim(`${String(i + 1).padStart(2)}.`) : style.dim(" ·");
    const branch = padVisible(style.cyan(branches[i]!), branchW + 2);
    const count = style.dim(`${r.info.imageCount} img`.padStart(7));
    const age = padVisible(style.dim(humanAge(r.info.startedAt)), 9);
    let line = `  ${lead} ${branch} ${count}  ${age}  ${r.info.title}`;
    if (showRepo && r.info.cwd) line += style.dim(`  · ${path.basename(r.info.cwd)}`);
    console.log(line);
  });
}

async function pickSession(a: CaptureAdapter, caps: Caps): Promise<Session | null> {
  const slug = slugForCwd(process.cwd());
  const all = a.listSessions();
  const inProj = all.filter((s) => s.project === slug);
  const crossProject = inProj.length === 0;
  const pool = crossProject ? all : inProj;

  // cheap metadata for each (no base64 decode); only sessions that actually have images
  const rows = pool
    .map((s) => ({ s, info: a.summarize(s) }))
    .filter((x) => x.info.imageCount > 0);

  if (rows.length === 0) {
    console.error("no sessions with images found.");
    return null;
  }

  // interactive picker when we have a TTY; numbered prompt otherwise
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const cache = new Map<string, Buffer | null>();
    const preview = (s: Session): Buffer | null => {
      if (cache.has(s.id)) return cache.get(s.id) ?? null;
      let bytes: Buffer | null = null;
      try {
        const first = a.extractImages(s).find((i) => isRenderable(i.mediaType));
        bytes = first ? first.bytes : null;
      } catch {
        bytes = null;
      }
      cache.set(s.id, bytes);
      return bytes;
    };
    return interactivePick(rows, { showRepo: crossProject, caps, preview });
  }

  if (crossProject) {
    console.log(style.dim("no sessions for this directory — showing all projects:\n"));
  }
  printSessionRows(rows, crossProject);
  process.stdout.write(`\nselect a session ${style.dim("[1]")}: `);

  const answer = await readLine();
  const idx = answer.trim() === "" ? 0 : Number(answer.trim()) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= rows.length) {
    console.error("invalid selection.");
    return null;
  }
  return rows[idx]!.s;
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

/** Scan the current project (ALL sessions, cheaply): pick the most-recent session
 * with images as active, and count how many sessions have images (browse hint).
 * Strictly project-scoped — returns null (not another project's images) when the
 * current directory has no recorded sessions. Only the chosen session is fully
 * loaded; the rest are summarised without decoding base64. */
function projectScan(
  a: CaptureAdapter
): { active: Session; images: StoredImage[]; info: SessionInfo; withImages: number } | null {
  const slug = slugForCwd(process.cwd());
  const proj = a.listSessions().filter((s) => s.project === slug);

  let active: Session | undefined;
  let activeInfo: SessionInfo | undefined;
  let withImages = 0;
  for (const s of proj) {
    const info = a.summarize(s);
    if (info.imageCount > 0) {
      withImages++;
      if (!active) {
        active = s;
        activeInfo = info;
      }
    }
  }
  if (active && activeInfo) {
    return { active, images: loadImages(active, a), info: activeInfo, withImages };
  }
  return null;
}

/** Stable, scriptable JSON shape for one stored image. */
function imageJson(img: StoredImage, s: Session, info: SessionInfo) {
  return {
    label: img.label,
    uncertain: img.uncertain,
    width: img.width,
    height: img.height,
    bytes: img.bytes,
    mediaType: img.mediaType,
    path: img.file,
    hash: img.hash,
    ts: img.ts,
    session: {
      id: s.id,
      project: s.project,
      branch: info.gitBranch ?? null,
      title: info.title,
      cwd: info.cwd ?? null,
    },
  };
}

function emitJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function cmdGallery(json = false): Promise<void> {
  const a = adapter();
  const r = projectScan(a);

  if (json) {
    emitJson(r ? r.images.map((i) => imageJson(i, r.active, r.info)) : []);
    return;
  }
  if (!r) {
    console.log(
      "no images found for this project (no Claude Code sessions here with pasted images)."
    );
    console.log("  `pastels -s` to browse sessions from other projects.");
    return;
  }

  const caps = await detectCaps();
  printGallery(r.images, caps, r.active, r.info);
  if (r.withImages > 1) {
    const others = r.withImages - 1;
    process.stdout.write(
      style.dim(
        `\n  most recent of ${r.withImages} sessions here — ${others} more with images. ` +
          `\`pastels -s\` to pick · \`pastels -a\` for all.\n`
      )
    );
  }
  // opportunistic, silent housekeeping (PRD §5.3) — by file mtime, never the
  // image you just viewed.
  gc(7);
}

/** `pastels -a` — every image in the current project, grouped by session. */
async function cmdAll(json = false): Promise<void> {
  const a = adapter();
  const slug = slugForCwd(process.cwd());
  const proj = a.listSessions().filter((s) => s.project === slug);

  if (json) {
    const out: unknown[] = [];
    for (const s of proj) {
      const info = a.summarize(s);
      if (info.imageCount === 0) continue;
      for (const img of loadImages(s, a)) out.push(imageJson(img, s, info));
    }
    emitJson(out);
    return;
  }

  const caps = await detectCaps();
  let any = false;
  for (const s of proj) {
    const info = a.summarize(s);
    if (info.imageCount === 0) continue;
    if (any) process.stdout.write("\n");
    printGallery(loadImages(s, a), caps, s, info);
    any = true;
  }
  if (!any) console.log("no images found in this project.");
  gc(7);
}

/** `pastels -A` — index of every image-bearing session across ALL projects,
 * grouped by project. The map for "show everything"; drill in with `cd` + pastels
 * or `pastels -s`. */
function cmdGlobal(json = false): void {
  const a = adapter();
  const rows = a
    .listSessions()
    .map((s) => ({ s, info: a.summarize(s) }))
    .filter((x) => x.info.imageCount > 0);

  if (json) {
    const out: unknown[] = [];
    for (const r of rows) for (const img of loadImages(r.s, a)) out.push(imageJson(img, r.s, r.info));
    emitJson(out);
    return;
  }

  if (rows.length === 0) {
    console.log("no images found in any project.");
    return;
  }

  const groups = new Map<string, { s: Session; info: SessionInfo }[]>();
  for (const r of rows) {
    const g = groups.get(r.s.project) ?? [];
    g.push(r);
    groups.set(r.s.project, g);
  }

  let totalImages = 0;
  const home = process.env.HOME ?? "";
  for (const [, grp] of groups) {
    const cwd = grp[0]!.info.cwd;
    const where = cwd ? (home ? cwd.replace(home, "~") : cwd) : grp[0]!.s.project;
    console.log(style.bold(where));
    printSessionRows(grp, false, false);
    console.log("");
    totalImages += grp.reduce((n, x) => n + x.info.imageCount, 0);
  }
  console.log(
    style.dim(
      `${rows.length} sessions · ${totalImages} images · ${groups.size} projects — ` +
        `cd in then \`pastels\`, or \`pastels -s\` to view.`
    )
  );
  gc(7);
}

/** Render [Image #n] from an already-loaded set. Degrades to a path for
 * non-graphics terminals or non-PNG formats. Returns false if no such image. */
async function renderImage(
  images: StoredImage[],
  n: number,
  caps: Caps
): Promise<boolean> {
  const img = findImage(images, n);
  if (!img) {
    console.error(`no [Image #${n}] in this session.`);
    return false;
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
    return true;
  }
  await show(images, images.indexOf(img), caps);
  return true;
}

async function cmdShow(arg: string | undefined, session?: Session): Promise<void> {
  const n = Number(arg);
  if (!arg || !Number.isInteger(n)) {
    console.error("usage: pastels show N");
    process.exitCode = 1;
    return;
  }
  const a = adapter();
  const caps = await detectCaps({ probe: true });
  const ctx = session ? { session, images: loadImages(session, a) } : defaultSession(a);
  if (!ctx) {
    console.error("no images found for this project. try `pastels -s` to pick another session.");
    process.exitCode = 1;
    return;
  }
  if (!(await renderImage(ctx.images, n, caps))) process.exitCode = 1;
}

/** `pastels -s` with no follow-up command: pick a session, then interactively
 * navigate its images (arrow keys + live preview), Enter to view full-screen.
 * (`pastels -s show N` / `pastels -s N` / `pastels -s path N` skip straight to
 * the action.) Non-TTY falls back to a static gallery. */
async function cmdBrowse(session: Session, caps: Caps): Promise<void> {
  const a = adapter();
  const images = loadImages(session, a);
  gc(7);

  if (!images.length) {
    printGallery(images, caps, session, a.summarize(session));
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    printGallery(images, caps, session, a.summarize(session));
    return;
  }

  // image picker ⇄ full-screen view loop until the user backs out
  for (;;) {
    const chosen = await interactiveImagePick(images, { caps });
    if (!chosen) break;
    await show(images, images.indexOf(chosen), caps);
  }
}

async function cmdPath(
  arg: string | undefined,
  session?: Session,
  opts: { copy?: boolean; json?: boolean } = {}
): Promise<void> {
  const n = Number(arg);
  if (!arg || !Number.isInteger(n)) {
    console.error("usage: pastels path N [--copy] [--json]");
    process.exitCode = 1;
    return;
  }
  const a = adapter();
  const ctx = session ? { session, images: loadImages(session, a) } : defaultSession(a);
  if (!ctx) {
    console.error("no images found for this project. try `pastels -s` to pick another session.");
    process.exitCode = 1;
    return;
  }
  const img = findImage(ctx.images, n);
  if (!img) {
    console.error(`no [Image #${n}] in this session.`);
    process.exitCode = 1;
    return;
  }
  if (opts.json) emitJson(imageJson(img, ctx.session, a.summarize(ctx.session)));
  else console.log(img.file);
  if (opts.copy) {
    if (copyToClipboard(img.file)) console.error(style.dim("copied to clipboard."));
    else console.error("no clipboard tool found (pbcopy / wl-copy / xclip / xsel).");
  }
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

/** `pastels watch` — resident auto-preview of the current project's latest paste.
 * Strictly project-scoped (cwd slug); run it in a dedicated pane/window. */
async function cmdWatch(): Promise<void> {
  const a = adapter();
  const slug = slugForCwd(process.cwd());
  const projectDir = path.join(projectsDir(), slug);
  const caps = await detectCaps({ probe: true });
  // watch the paste-time image-cache (renders before submit) and the transcript
  // dir (post-submit fallback); both are fs.watched for instant triggers.
  await watch(a, slug, [imageCacheDir(), projectDir], caps);
}

async function cmdClear(): Promise<void> {
  const caps = await detectCaps();
  // panic delete-all, tmux-wrapped if needed, then restore the cursor.
  process.stdout.write(wrap(deleteAllSeq(), caps.inTmux));
  process.stdout.write("\x1b[?25h");
  console.error("cleared terminal graphics.");
}

async function main(): Promise<void> {
  const raw = process.argv.slice(2);
  // --json is a global flag, not a command/operand — strip it before dispatch
  const json = raw.includes("--json");
  const argv = raw.filter((a) => a !== "--json");

  // a leading -s / --session selects a session, then the remaining args run as usual
  let session: Session | undefined;
  let pickedViaFlag = false;
  let pickedCaps: Caps | undefined;
  if (argv[0] === "-s" || argv[0] === "--session") {
    argv.shift();
    pickedCaps = await detectCaps({ probe: true }); // probe once, reused for picker + preview
    const picked = await pickSession(adapter(), pickedCaps);
    if (!picked) {
      process.exitCode = 1;
      return;
    }
    session = picked;
    pickedViaFlag = true;
  }

  const cmd = argv[0];
  switch (cmd) {
    case undefined:
      // `pastels -s` → interactive image picker; bare `pastels` → default gallery
      if (pickedViaFlag && session) await cmdBrowse(session, pickedCaps!);
      else await cmdGallery(json);
      break;
    case "-a":
    case "--all":
    case "all":
      await cmdAll(json);
      break;
    case "-A":
    case "--global":
      cmdGlobal(json);
      break;
    case "show":
      await cmdShow(argv[1], session);
      break;
    case "path":
      await cmdPath(argv[1], session, { copy: argv.includes("--copy"), json });
      break;
    case "watch":
      await cmdWatch();
      break;
    case "gc":
      cmdGc(argv.slice(1));
      break;
    case "clear":
      await cmdClear();
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
      // bare `pastels N` is shorthand for `pastels show N`
      if (/^\d+$/.test(cmd)) {
        await cmdShow(cmd, session);
        break;
      }
      console.error(`unknown command: ${cmd}\n`);
      process.stdout.write(USAGE);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("pastels:", err?.message ?? err);
  process.exit(1);
});
