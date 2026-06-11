# pastels

> See what you pasted. Image recall for agentic CLI sessions over SSH.

When you paste an image into Claude Code, the chat shows an opaque reference like
`[Image #1]` and gives you no way to look at it again. The bytes are buried in the
session transcript on disk. Over SSH it is worse, because those bytes live on the
headless remote and never reach your local machine.

`pastels` recovers every image you pasted and paints it back in your terminal,
labelled with the exact `[Image #N]` it has in the conversation.

> _(demo gif goes here)_

## Install

```sh
npm i -g pastels
```

Requires Node 18 or newer. Image rendering needs a terminal that speaks the
[kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/),
such as kitty, ghostty, or WezTerm. Without one you still get the text gallery
and file paths.

## Usage

```sh
pastels            # text gallery of images in the current session
pastels show 4     # full-screen render of [Image #4], works inside tmux too
pastels path 4     # print its file path to re-feed to the agent or save it
```

Full command surface:

```
pastels                  text gallery of the current session
pastels -a               every image in this project, grouped by session
pastels -A               index of image sessions across all projects
pastels show N           full-pane render of [Image #N]
pastels N                shorthand for pastels show N
pastels -s               interactive picker with live preview, then render
pastels -s N             pick a session, then render [Image #N] from it
pastels path N [--copy]  print the file path, optionally copy it to the clipboard
pastels gc [--days 7]    prune images not seen in N days
pastels clear            delete any stranded terminal graphics
```

`[Image #N]` labels are per-session counters, so the bare gallery shows one
session at a time. Use `-a` to sweep the whole project, `-A` for every project, or
`-s` for the interactive picker.

### Interactive picker

`pastels -s` opens a session picker, then an image picker for the session you
choose. Both support arrow keys and vim motions.

```
j / k or down / up   move
g / G                jump to first / last
enter or l           open
/ or f               filter sessions (session picker)
c                    copy the image path to your clipboard (image picker)
p                    print the image path (image picker)
q / h or esc         back or quit
```

Inside the image viewer, left and right (or h and l) step to the previous and
next image, and q returns.

### Viewing on the right machine

`pastels show N` paints the image on your local terminal even though it runs on
the remote box. The kitty escape sequences travel back over the SSH connection,
and `pastels` wraps them in tmux passthrough and enables passthrough for you.
Inside tmux the terminal identity is hidden, so `pastels` actively probes for
graphics support instead of guessing from environment variables.

If a render falls back to printing a path, override detection with environment
variables:

```sh
PASTELS_FORCE_GRAPHICS=1 pastels show N   # your terminal supports kitty graphics
PASTELS_PLAIN_CLEAR=1 pastels show N      # if alt-screen misbehaves under tmux
PASTELS_NO_GRAPHICS=1 pastels show N      # force the text and path fallback
```

Copying a path with `c` or `--copy` uses OSC 52, which writes to your local
clipboard over SSH. Some terminals block clipboard writes by default, so you may
need to allow it in your terminal settings.

### Keeping more history

`pastels` can only see sessions that Claude Code still keeps. Claude Code deletes
old transcripts according to its `cleanupPeriodDays` setting, which defaults to 30
days. To retain more, raise it in your Claude Code settings, for example
`{ "cleanupPeriodDays": 365 }`.

## How it works

`pastels` reads Claude Code's own session transcripts under
`~/.claude/projects/**/*.jsonl`, where pasted images are stored inline as base64.
The `[Image #N]` label comes straight from each message's `imagePasteIds` array,
so the number you see matches the number in your conversation exactly, even when
the counter skips deleted pastes. Recovered images live in a content-addressed
store under `~/.pastels/`.

Inside tmux, kitty graphics cannot be placed inline without desyncing the grid, so
`pastels` shows a text gallery and reserves image rendering for the full-pane
`show N` takeover, which restores your scrollback when you exit. Every render
deletes its graphic on exit, including on Ctrl-C and SIGTERM, so nothing is left
overlaying your session. If something ever is, `pastels clear` removes it.

## Can it be automatic?

Not fully. Claude Code owns how `[Image #N]` is drawn, and an external tool cannot
attach behaviour to it or paint into the live composer. You can get semi-automatic
recall with a hook that shows new pastes in a side tmux pane or logs their paths.
See [docs/automation.md](docs/automation.md). This is intentionally out of v0.

## Pairs with cc-clip

cc-clip handles clipboard transport over SSH and `pastels` handles recall. cc-clip
gets the image in, and `pastels` lets you see it again. They compose well, so use
both.

## License

Released under the [MIT License](LICENSE).
