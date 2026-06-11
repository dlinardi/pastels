# CLAUDE.md — pastels

see see what you pasted: image recall for agentic CLI sessions over SSH.
the spec is docs/pastels-prd.md. read it before writing code. it is authoritative.

## status
- v0.0.1 (phase 1) is BUILT, TESTED, and PUBLISHED to npm (tag latest), tagged v0.0.1 on GitHub. all five v0 commands ship and work over SSH+tmux on dave's devbox.
- CURRENT WORK: phase-4 `watch` mode (auto side-pane preview on paste). this is now IN SCOPE. design notes in docs/automation.md.

## scope discipline
- the active work item is `watch` mode (PRD phase 4) ONLY. everything else still parked: no launch/marketing, no web UI, no second harness adapter, no shim adapter. do not build those.
- anything in §4 non-goals stays a non-goal (no clipboard bridge, no image editing/OCR, no Windows, no inline scrolling gallery inside tmux).
- if you think something outside `watch` is needed, stop and ask, don't build it.

## hard requirements (from prd §5.4 — these are non-negotiable)
- renderer graphics teardown: `show N` MUST send explicit kitty delete (\x1b_Ga=d) on exit AND install SIGINT/SIGTERM handlers that delete placements before exiting. a stranded graphic overlays the user's whole tmux session. this must never leak. `pastels clear` is the panic command.
- tmux: detect $TMUX, wrap kitty graphics sequences in the \x1bPtmux; envelope (every \x1b doubled). do NOT wrap alt-screen/clear control sequences.
- inline thumbnails only when $TMUX is unset. in tmux, text gallery + hint to use `show N`.
- transcript parsing is defensive: unknown shapes degrade gracefully, never crash. ship a fixture transcript as a canary test.

## architecture (prd §5)
- portable core (harness-agnostic) + thin CaptureAdapter. v0 ships ONE adapter: ClaudeCodeTranscriptAdapter.
- core: content-addressed PNG store under ~/.pastels/, index.jsonl, PNG dims from IHDR (no imagemagick).
- the shim adapter and any second harness are NOT v0. interface only.

## stack & conventions
- typescript, strict. single npm package. bin: "pastels".
- zero runtime deps if possible; tiny ones ok. no framework.
- vitest for tests, write them alongside code.
- conventional commits, small and frequent.

## before writing the renderer
verify the two open build-time questions in the prd and report findings first:
1. does [Image #N] reliably equal appearance order? (reference a known image, check)
2. does alt-screen + kitty hold under tmux, or is plain clear the fallback?

## stop conditions
- phase 1 deliverables (§5.5: pastels | show N | -s | path N | gc) are DONE and shipped.
- after `watch` mode is built and tested, STOP.
- do not start launch, marketing, web UI, or opencode/codex/shim adapters.
