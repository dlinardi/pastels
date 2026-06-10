import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CaptureAdapter, CapturedImage, Session } from "./types";

// Claude Code persists session transcripts as JSONL under
//   ~/.claude/projects/<project-slug>/<session-id>.jsonl
// where <project-slug> is the cwd with every non-alphanumeric char replaced by '-'.
//
// Pasted images live inline as standard content blocks (PRD §5.1):
//   { type:"image", source:{ type:"base64", media_type, data } }
//
// The [Image #N] label is NOT document-appearance order — it is a per-session
// paste counter that skips deleted pastes. The authoritative label source is the
// top-level `imagePasteIds` array on each user record (verified phase 1). We zip
// image blocks with imagePasteIds, falling back to in-text [Image #N] refs, then
// to appearance order (flagged uncertain). Parsing is defensive throughout:
// unknown shapes degrade, never crash.

const IMAGE_REF = /\[Image #(\d+)\]/g;

export function projectsDir(): string {
  return (
    process.env.CLAUDE_PROJECTS_DIR ??
    path.join(os.homedir(), ".claude", "projects")
  );
}

/** Claude Code's project-slug rule: cwd with non-alphanumerics collapsed to '-'. */
export function slugForCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

function collectTextRefs(content: unknown[]): number[] {
  const refs: number[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as any).type === "text" &&
      typeof (block as any).text === "string"
    ) {
      for (const m of ((block as any).text as string).matchAll(IMAGE_REF)) {
        refs.push(Number(m[1]));
      }
    }
  }
  return refs;
}

export class ClaudeCodeTranscriptAdapter implements CaptureAdapter {
  name = "claude-code";

  detect(): boolean {
    try {
      return fs.statSync(projectsDir()).isDirectory();
    } catch {
      return false;
    }
  }

  listSessions(): Session[] {
    const root = projectsDir();
    const sessions: Session[] = [];
    let projects: string[];
    try {
      projects = fs.readdirSync(root);
    } catch {
      return [];
    }
    for (const project of projects) {
      const dir = path.join(root, project);
      let files: string[];
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
        files = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const fp = path.join(dir, file);
        let mtime = 0;
        try {
          mtime = fs.statSync(fp).mtimeMs;
        } catch {
          continue;
        }
        sessions.push({
          id: file.replace(/\.jsonl$/, ""),
          path: fp,
          project,
          mtime,
        });
      }
    }
    sessions.sort((a, b) => b.mtime - a.mtime);
    return sessions;
  }

  extractImages(session: Session): CapturedImage[] {
    let raw: string;
    try {
      raw = fs.readFileSync(session.path, "utf8");
    } catch {
      return [];
    }

    const images: CapturedImage[] = [];
    let appearance = 0;

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let rec: any;
      try {
        rec = JSON.parse(trimmed);
      } catch {
        // truncated / partial / non-JSON line — degrade, don't crash.
        continue;
      }

      const msg = rec?.message ?? rec;
      const content = msg?.content;
      if (!Array.isArray(content)) continue; // string content or unknown shape

      const blocks = content.filter(
        (b: any) => b && typeof b === "object" && b.type === "image"
      );
      if (blocks.length === 0) continue;

      const pasteIds: number[] | null = Array.isArray(rec?.imagePasteIds)
        ? rec.imagePasteIds.filter((x: unknown) => typeof x === "number")
        : null;
      const textRefs = collectTextRefs(content);
      const ts = typeof rec?.timestamp === "string" ? rec.timestamp : undefined;
      const sessionId =
        typeof rec?.sessionId === "string" ? rec.sessionId : session.id;

      const useIds = pasteIds && pasteIds.length === blocks.length;
      const useRefs = !useIds && textRefs.length === blocks.length;

      blocks.forEach((block: any, i: number) => {
        appearance++;

        const data = block?.source?.data;
        if (typeof data !== "string" || data.length === 0) return; // unrecoverable

        let bytes: Buffer;
        try {
          bytes = Buffer.from(data, "base64");
        } catch {
          return;
        }
        if (bytes.length === 0) return;

        let label: number;
        let uncertain: boolean;
        if (useIds) {
          label = pasteIds![i]!;
          uncertain = false;
        } else if (useRefs) {
          label = textRefs[i]!;
          uncertain = false;
        } else {
          label = appearance;
          uncertain = true;
        }

        const mediaType =
          typeof block?.source?.media_type === "string"
            ? block.source.media_type
            : "image/png";

        images.push({ label, appearance, uncertain, bytes, mediaType, ts, sessionId });
      });
    }

    return images;
  }
}
