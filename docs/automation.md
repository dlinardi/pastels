# automation: can pastels replace cmd+click? (experimental, not v0)

> Status: **design notes only.** Nothing here ships in v0. This is the `pastels
> watch` / live-mode territory the PRD parks in phase 4 (§4 non-goals: "no daemon,
> no background process"). Treat the scripts below as starting points, and verify
> the hook payload against the current Claude Code hooks docs before relying on it.

## the honest constraints

You asked: can we make seeing a pasted image automatic — like cmd+click — instead
of typing `pastels show N`? Three hard limits:

1. **We don't own Claude Code's renderer.** The `[Image #N]` text and its
   cmd+click behaviour are drawn by Claude Code's TUI. We can't attach a handler
   or change what its click does. (Claude Code's native cmd+click also only exists
   on the rendered reference, and it opens the image in the *remote* machine's
   viewer — which is the whole reason it's useless over SSH.)

2. **A hook can't paint to your screen.** Claude Code hooks run with **stdout
   captured by Claude Code** — for `UserPromptSubmit`, stdout is fed back into the
   *model's* context, not shown to you. A hook has no direct access to your
   terminal, so it can't take over the screen the way `pastels show` does. (There
   is an experimental `terminalSequence` JSON output field, but its rendering is
   context-dependent and unreliable under tmux.)

3. **Inline graphics in a live TUI desync under tmux.** This is the load-bearing
   phase-0 finding and the reason `show N` takes over the screen in the first
   place. Anything that tries to paint an image *inline* while Claude Code owns the
   foreground fights its grid. So "auto-render the image right where you pasted it"
   is structurally out, in tmux.

Net: true click-to-view isn't achievable from outside Claude Code. What *is*
achievable is **semi-automatic**: a hook that fires when you submit a prompt and
nudges the image onto a screen you control.

## the event

`UserPromptSubmit` fires once, right after you submit, before the model runs. Its
stdin JSON includes:

```json
{
  "session_id": "…",
  "transcript_path": "/…/.claude/projects/<slug>/<session>.jsonl",
  "cwd": "/…/your-project",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "the text you submitted"
}
```

`transcript_path` is the key: by the time the hook runs, your freshly-pasted
image is already the last user record in that file — with its `imagePasteIds`.

## recipe A — auto-show in a dedicated tmux pane (best effort)

Run Claude Code in one tmux pane and keep a second pane for pastels. The hook
extracts the just-pasted label(s) and `tmux send-keys` a `pastels show N` into the
pastels pane. Nothing paints over Claude Code; the image appears next door.

`~/.pastels/hooks/on-paste.sh`:

```bash
#!/usr/bin/env bash
# Experimental. Reads the UserPromptSubmit payload on stdin and, if the latest
# user message carried pasted images, drives `pastels show N` in a tmux pane
# titled "pastels". Requires: node, jq, tmux, pastels on PATH.
set -euo pipefail

payload=$(cat)
transcript=$(printf '%s' "$payload" | jq -r '.transcript_path')
[ -f "$transcript" ] || exit 0

# imagePasteIds of the LAST user record that has any (the message you just sent)
ids=$(node -e '
  const fs=require("fs");
  const lines=fs.readFileSync(process.argv[1],"utf8").trim().split("\n");
  for (let i=lines.length-1;i>=0;i--){
    let r; try{r=JSON.parse(lines[i])}catch{continue}
    if (Array.isArray(r.imagePasteIds) && r.imagePasteIds.length){
      console.log(r.imagePasteIds.join(" ")); break;
    }
  }
' "$transcript")
[ -n "$ids" ] || exit 0

# target a tmux pane named "pastels"; create one on the right if absent
if ! tmux list-panes -F '#{pane_title}' 2>/dev/null | grep -qx pastels; then
  tmux split-window -h -d 'printf "\033]2;pastels\033\\"; exec $SHELL' 2>/dev/null || exit 0
fi
target=$(tmux list-panes -F '#{pane_id} #{pane_title}' | awk '$2=="pastels"{print $1; exit}')

for n in $ids; do
  tmux send-keys -t "$target" "pastels show $n" Enter
done
exit 0
```

Register it (`~/.claude/settings.json`, or per-project `.claude/settings.json`):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "~/.pastels/hooks/on-paste.sh" } ] }
    ]
  }
}
```

Caveats: `UserPromptSubmit` has a ~30s timeout (keep it fast), fires on *every*
prompt (the script no-ops when there are no new paste ids), and multiple pasted
ids queue multiple `show` calls — each waits for a keypress, so you step through
them. Pane-title plumbing varies by tmux config; adjust to taste.

## recipe B — a tailing log (simplest, no tmux assumptions)

If juggling panes is too much, have the hook just append new image paths to a
file you watch in a split:

```bash
# inside on-paste.sh, replacing the tmux block:
for n in $ids; do
  echo "[Image #$n]  $(cd "$cwd" && pastels path "$n" 2>/dev/null)"
done >> ~/.pastels/recent.log
```

```sh
tail -f ~/.pastels/recent.log     # in any spare pane
```

You still run `pastels show N` to *view*, but you never have to hunt for which N —
the latest pastes scroll past as you work.

## why this stays out of v0

Both recipes are real features with their own failure modes (tmux layout
assumptions, hook timeouts, format drift). The v0 contract is the explicit,
predictable `pastels show N`. If semi-automatic recall proves itself in
dogfooding, it graduates into a real `pastels watch` — designed, not bolted on.
