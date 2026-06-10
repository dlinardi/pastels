import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CapturedImage } from "../adapters/types";
import { extForMedia, imageDimensions } from "./png";

// Content-addressed image store under ~/.pastels/ (PRD §5.3):
//   images/<sha256-12>.png   content-addressed, dedupe-free
//   index.jsonl              one record per stored (image, label) pair

export interface IndexRecord {
  ts: string;
  hash: string;
  bytes: number;
  w: number | null;
  h: number | null;
  source: string;
  session_id?: string;
  image_n?: number;
}

export interface StoredImage {
  label: number;
  appearance: number;
  uncertain: boolean;
  hash: string;
  file: string;
  width: number | null;
  height: number | null;
  bytes: number;
  mediaType: string;
  ts: string;
  source: string;
  sessionId?: string;
}

export function pastelsDir(): string {
  return process.env.PASTELS_DIR ?? path.join(os.homedir(), ".pastels");
}

export function imagesDir(): string {
  return path.join(pastelsDir(), "images");
}

export function indexPath(): string {
  return path.join(pastelsDir(), "index.jsonl");
}

function ensureDirs(): void {
  fs.mkdirSync(imagesDir(), { recursive: true });
}

export function readIndex(): IndexRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(indexPath(), "utf8");
  } catch {
    return [];
  }
  const out: IndexRecord[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // skip corrupt line, keep going
    }
  }
  return out;
}

function writeIndex(records: IndexRecord[]): void {
  ensureDirs();
  const body = records.map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(indexPath(), body.length ? body + "\n" : "");
}

function hashOf(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

/**
 * Persist a batch of captured images. Writes each PNG once (content-addressed),
 * refreshes its mtime on every recall (so gc tracks last-seen, not first-seen),
 * and appends new index records, deduped by (hash, session, label).
 */
export function ingest(images: CapturedImage[], source: string): StoredImage[] {
  ensureDirs();
  const existing = readIndex();
  const seen = new Set(
    existing.map((r) => `${r.hash}|${r.session_id ?? ""}|${r.image_n ?? ""}`)
  );
  const append: IndexRecord[] = [];
  const out: StoredImage[] = [];

  for (const img of images) {
    const hash = hashOf(img.bytes);
    const file = path.join(imagesDir(), `${hash}${extForMedia(img.mediaType)}`);
    if (fs.existsSync(file)) {
      try {
        const now = new Date();
        fs.utimesSync(file, now, now);
      } catch {
        // best effort
      }
    } else {
      fs.writeFileSync(file, img.bytes);
    }

    const dims = imageDimensions(img.bytes);
    const ts = img.ts ?? new Date().toISOString();
    const rec: IndexRecord = {
      ts,
      hash,
      bytes: img.bytes.length,
      w: dims?.width ?? null,
      h: dims?.height ?? null,
      source,
      session_id: img.sessionId,
      image_n: img.label,
    };

    const key = `${hash}|${img.sessionId ?? ""}|${img.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      append.push(rec);
    }

    out.push({
      label: img.label,
      appearance: img.appearance,
      uncertain: img.uncertain,
      hash,
      file,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      bytes: img.bytes.length,
      mediaType: img.mediaType,
      ts,
      source,
      sessionId: img.sessionId,
    });
  }

  if (append.length) {
    const body = append.map((r) => JSON.stringify(r)).join("\n") + "\n";
    fs.appendFileSync(indexPath(), body);
  }

  return out;
}

/**
 * Prune images whose backing file hasn't been touched in `days`, then drop any
 * index records pointing at files that no longer exist. gc runs by file mtime
 * (last recall), not message timestamp, so recently-viewed images survive.
 */
export function gc(days = 7): { filesDeleted: number; entriesPruned: number } {
  const dir = imagesDir();
  const cutoff = Date.now() - days * 86_400_000;
  let filesDeleted = 0;

  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return { filesDeleted: 0, entriesPruned: 0 };
  }

  const survivors = new Set<string>();
  for (const f of files) {
    const fp = path.join(dir, f);
    try {
      if (fs.statSync(fp).mtimeMs < cutoff) {
        fs.rmSync(fp);
        filesDeleted++;
      } else {
        survivors.add(f.split(".")[0]!); // hash = basename before extension
      }
    } catch {
      // ignore
    }
  }

  const records = readIndex();
  const alive = records.filter((r) => survivors.has(r.hash));
  const entriesPruned = records.length - alive.length;
  if (entriesPruned > 0 || filesDeleted > 0) writeIndex(alive);

  return { filesDeleted, entriesPruned };
}
