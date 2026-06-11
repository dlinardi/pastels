# pastels

> see what you pasted — image recall for agentic CLI sessions over SSH.

When you paste an image into Claude Code, the chat shows an opaque reference like
`[Image #1]` with no way to see it again. Claude Code's answer — Cmd+Click the
link to open it in your viewer — **breaks over SSH**: the "viewer" is on the
headless remote and the path doesn't exist locally.

`pastels` recovers every image you pasted and paints it back in the terminal,
labelled with the exact `[Image #N]` it has in the conversation.

> _(demo gif goes here)_

## install

```sh
npm i -g pastels
```

Requires Node ≥ 18 and a terminal that speaks the [kitty graphics
protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) for image rendering
(kitty, ghostty, WezTerm, …). Without one, you still get the text gallery and
file paths.

## usage

```sh
pastels            # text gallery: every [Image #N] in the current session
pastels show 4     # full-screen render of [Image #4] — works inside tmux too
pastels path 4     # print its file path (re-feed to the agent, or save it)
```

Full surface:

```
pastels                  text gallery of the current session
pastels -a               every image in this project, grouped by session
pastels -A               index of image sessions across ALL projects
pastels show N           full-pane render of [Image #N] (alt-screen, any-key to return)
pastels N                shorthand for `pastels show N`
pastels -s               interactive picker (↑/↓ + filter + live preview), then render
pastels -s N             pick a session, then render [Image #N] from it
pastels path N [--copy]  print (and optionally clipboard-copy) the file path
pastels gc [--days 7]    prune images not seen in N days
pastels clear            panic: delete any stranded terminal graphics
```

`[Image #N]` labels are **per-session** counters, so the bare gallery shows one
session at a time; use `-a` to sweep the whole project, `-A` for every project, or
`-s` for an interactive, filterable session picker.

### want more history?

`pastels` can only see sessions Claude Code still keeps. Claude Code deletes old
transcripts per its `cleanupPeriodDays` setting (default 30). To retain more, raise
it in your Claude Code settings, e.g. `{ "cleanupPeriodDays": 365 }`.

## how it works

`pastels` reads Claude Code's own session transcripts
(`~/.claude/projects/**/*.jsonl`), where pasted images are stored inline as
base64. The `[Image #N]` label comes straight from the message's `imagePasteIds`
— so the number you see matches the number in your conversation exactly, even
when the counter skips deleted pastes. Recovered images are kept in a
content-addressed store under `~/.pastels/`.

Inside tmux, kitty graphics can't be placed inline without desyncing the grid, so
`pastels` shows a text gallery and reserves image rendering for the full-pane
`show N` takeover (which restores your scrollback on exit). `show N` always
deletes its graphic on exit — including on Ctrl-C — so nothing is ever left
overlaying your session. If one ever is, `pastels clear` nukes it.

## over SSH + tmux (the main use case)

`pastels show N` paints the image on your **local** terminal even though it runs
on the remote box — the kitty escape sequences travel back over the SSH PTY, and
`pastels` wraps them in tmux's passthrough envelope and enables passthrough for
you. Inside tmux, `TERM` becomes `tmux-256color` and your terminal's identity
isn't forwarded, so `pastels` actively probes the terminal to confirm graphics
support rather than guessing from environment variables.

If `show N` prints a path instead of rendering, the probe couldn't confirm
support (flaky/slow SSH, an unusual terminal). Force it:

```sh
PASTELS_FORCE_GRAPHICS=1 pastels show N     # you know your terminal speaks kitty graphics
PASTELS_PLAIN_CLEAR=1 pastels show N        # if alt-screen misbehaves under tmux
PASTELS_NO_GRAPHICS=1 pastels show N        # force the text+path fallback
```

## can it be automatic, like cmd+click?

Short version: not fully — Claude Code owns the `[Image #N]` rendering and a hook
can't paint to your screen. But you can get *semi*-automatic recall (a hook that
shows new pastes in a side tmux pane, or logs their paths). See
[docs/automation.md](docs/automation.md). It's deliberately out of v0.

## works great with [cc-clip](https://github.com/) <!-- link -->

cc-clip owns clipboard transport over SSH; pastels owns recall. cc-clip gets the
image *in*; pastels lets you *see it again*. They compose — use both.

## license

MIT
