# CLAUDE.md — pastels

see see what you pasted: image recall for agentic CLI sessions over SSH.
the spec is docs/pastels-prd.md. read it before writing code. it is authoritative.

## scope discipline
- build PHASE 1 (v0) ONLY. anything marked phase 2+, or in §4 non-goals, is out of scope — do not build it even if it seems easy or related.
- if you think something outside phase 1 is needed, stop and ask, don't build it.

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
- after phase 1 deliverables (§5.5: pastels | show N | -s | path N | gc) are built and tested, STOP.
- do not start launch, marketing, web UI, opencode/codex adapters, or `watch` mode.
