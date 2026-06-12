import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  ClaudeCodeTranscriptAdapter,
  imageCacheDir,
  projectsDir,
  slugForCwd,
} from "../adapters/claude-code";
import type { CaptureAdapter, Session, SessionInfo } from "../adapters/types";
import { ingest, type StoredImage } from "../core/store";
import { style } from "../util/format";
import { renderPage } from "./page";

// `pastels serve` — a tiny, zero-dep HTTP gallery of the current project's pasted
// images, live-updated as you paste (PRD phase 4 web gallery). A browser tab is a
// display surface we own, so this sidesteps the terminal-ownership wall entirely
// and works in ANY terminal, including ones with no graphics support.
//
// Safe by default: binds 127.0.0.1 (reachable through `ssh -L` / a ssh-config
// LocalForward) and ALSO the Tailscale IP when present (tailnet-only, never the
// public interface). Images are served from the local content-addressed store.

const DEBOUNCE_MS = 150;
const POLL_MS = 1500;
const DEFAULT_PORT = 7777;

/**
 * The host's Tailscale IPv4 (100.64.0.0/10 CGNAT range), or null. Pure so it can
 * be unit-tested with a synthetic interface map.
 */
export function tailnetIp(
  ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()
): string | null {
  for (const list of Object.values(ifaces)) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) {
        const parts = ni.address.split(".").map(Number);
        if (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127) return ni.address;
      }
    }
  }
  return null;
}

/** Public JSON shape for one image (no base64 — bytes come from /img/<hash>). */
export function imageToJson(i: StoredImage) {
  return {
    label: i.label,
    uncertain: i.uncertain,
    w: i.width,
    h: i.height,
    bytes: i.bytes,
    mediaType: i.mediaType,
    ts: i.ts,
    hash: i.hash,
    path: i.file,
    url: `/img/${i.hash}`,
  };
}

/**
 * All of a session's images: submitted (transcript) merged with in-flight
 * (paste-time image-cache), deduped by hash+label, sorted by label. Either
 * source failing degrades to the other rather than throwing.
 */
export function sessionImages(a: CaptureAdapter, session: Session): StoredImage[] {
  const src = `${a.name}:${session.id}`;
  const out: StoredImage[] = [];
  const seen = new Set<string>();
  const add = (imgs: StoredImage[]): void => {
    for (const i of imgs) {
      const k = `${i.hash}|${i.label}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(i);
      }
    }
  };
  try {
    add(ingest(a.extractImages(session), src));
  } catch {
    // transcript unreadable — fall through to live cache
  }
  try {
    if (a.liveImages) add(ingest(a.liveImages(session), src));
  } catch {
    // no cache — fine
  }
  return out.sort((x, y) => x.label - y.label || x.appearance - y.appearance);
}

export interface ServeOptions {
  port?: number;
  cwd?: string;
}

/**
 * Start the gallery server. Resolves when the process is told to stop
 * (SIGINT/SIGTERM). Strictly scoped to the project at `cwd` (slug rule), so it
 * never serves another project's images.
 */
export async function serve(opts: ServeOptions = {}): Promise<void> {
  const a: CaptureAdapter = new ClaudeCodeTranscriptAdapter();
  const cwd = opts.cwd ?? process.cwd();
  const slug = slugForCwd(cwd);
  const port = opts.port ?? DEFAULT_PORT;

  let images: StoredImage[] = [];
  let info: SessionInfo | null = null;
  let sig = "";
  const clients = new Set<http.ServerResponse>();

  const scan = (): void => {
    let session: Session | null = null;
    try {
      session = a.listSessions().find((s) => s.project === slug) ?? null;
    } catch {
      session = null;
    }
    if (!session) {
      images = [];
      info = null;
    } else {
      images = sessionImages(a, session);
      try {
        info = a.summarize(session);
      } catch {
        info = null;
      }
    }
    const next = images.map((i) => `${i.hash}:${i.label}`).join(",");
    if (next !== sig) {
      sig = next;
      for (const res of clients) {
        try {
          res.write("data: changed\n\n");
        } catch {
          // dropped client — close handler will prune it
        }
      }
    }
  };

  const sendJson = (res: http.ServerResponse, value: unknown): void => {
    const body = JSON.stringify(value);
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(body);
  };

  const serveImg = (hash: string, res: http.ServerResponse): void => {
    const img = images.find((i) => i.hash === hash);
    if (!img) {
      res.writeHead(404);
      res.end();
      return;
    }
    let buf: Buffer;
    try {
      buf = fs.readFileSync(img.file);
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": img.mediaType, "cache-control": "no-cache" });
    res.end(buf);
  };

  const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const url = (req.url || "/").split("?")[0]!;
    if (url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderPage());
    } else if (url === "/api/images") {
      sendJson(res, images.map(imageToJson));
    } else if (url === "/api/session") {
      sendJson(res, {
        project: path.basename(cwd),
        title: info?.title ?? null,
        branch: info?.gitBranch ?? null,
        count: images.length,
      });
    } else if (url === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write("retry: 2000\n\n");
      res.write("data: hello\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
    } else if (url.startsWith("/img/")) {
      serveImg(decodeURIComponent(url.slice(5)), res);
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  };

  scan(); // prime the first frame before we accept connections

  const servers: http.Server[] = [];
  const listenOn = (host: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const s = http.createServer(handler);
      s.on("error", reject);
      s.listen(port, host, () => {
        servers.push(s);
        resolve();
      });
    });

  await listenOn("127.0.0.1");
  const tip = tailnetIp();
  if (tip) {
    try {
      await listenOn(tip);
    } catch {
      // tailnet bind failed (port busy on that iface) — localhost still serves
    }
  }

  // live triggers: fs.watch the image-cache + transcript dir, plus a poll floor
  const recursive = process.platform === "darwin";
  const watchDirs = [imageCacheDir(), path.join(projectsDir(), slug)];
  const watchers: fs.FSWatcher[] = [];
  let debounce: NodeJS.Timeout | undefined;
  const trigger = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(scan, DEBOUNCE_MS);
  };
  for (const dir of watchDirs) {
    try {
      watchers.push(fs.watch(dir, { persistent: true, recursive }, () => trigger()));
    } catch {
      // missing dir / unsupported — poll covers it
    }
  }
  const pollTimer = setInterval(trigger, POLL_MS);

  printAccess(port, tip);

  return new Promise<void>((resolve) => {
    const shutdown = (): void => {
      clearInterval(pollTimer);
      if (debounce) clearTimeout(debounce);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
      for (const res of clients) {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
      for (const s of servers) {
        try {
          s.close();
        } catch {
          // ignore
        }
      }
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      console.error("\npastels: gallery stopped.");
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

/** Print the access ladder: tailnet one-click when available, plus the
 * one-time ssh-config LocalForward and the per-session ssh -L fallback. */
function printAccess(port: number, tip: string | null): void {
  const host = os.hostname();
  console.error(style.bold("\n  pastels gallery is live\n"));
  if (tip) {
    console.error("  " + style.green("tailnet (one click):"));
    console.error(`     http://${tip}:${port}`);
    if (host) console.error(`     http://${host}:${port}   ${style.dim("(if MagicDNS is on)")}`);
    console.error("");
  }
  console.error("  " + style.cyan("over ssh (any setup):"));
  console.error(
    style.dim("     add to ~/.ssh/config under your devbox Host, then reconnect:")
  );
  console.error(`       LocalForward ${port} localhost:${port}`);
  console.error(`     then open  http://localhost:${port}`);
  console.error(style.dim(`     one-off:   ssh -L ${port}:localhost:${port} ${host || "<devbox>"}`));
  console.error(style.dim("\n  ctrl-c to stop.\n"));
}
