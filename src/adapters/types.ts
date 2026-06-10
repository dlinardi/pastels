// Capture adapter interface (PRD §5.6). The core + renderer are harness-agnostic;
// each harness implements this. v0 ships exactly one: ClaudeCodeTranscriptAdapter.

export interface Session {
  /** session id (filename without extension for the transcript adapter) */
  id: string;
  /** absolute path to the backing transcript/source */
  path: string;
  /** project slug / grouping the session belongs to */
  project: string;
  /** last-modified time in ms since epoch, for recency sorting */
  mtime: number;
}

export interface CapturedImage {
  /** the [Image #N] number as it appears in the conversation */
  label: number;
  /** 1-based document-appearance order within the session */
  appearance: number;
  /** true when `label` is a best-effort fallback, not an authoritative id */
  uncertain: boolean;
  /** decoded image bytes */
  bytes: Buffer;
  /** e.g. "image/png", "image/jpeg" */
  mediaType: string;
  /** ISO timestamp from the source record, when available */
  ts?: string;
  /** originating session id, when available */
  sessionId?: string;
}

export interface CaptureAdapter {
  /** stable adapter name, e.g. "claude-code" */
  name: string;
  /** is this harness present and a session store available? */
  detect(): boolean;
  /** all sessions this adapter can see, most-recent first */
  listSessions(): Session[];
  /** recover images from a session, in document order */
  extractImages(session: Session): CapturedImage[];
}
