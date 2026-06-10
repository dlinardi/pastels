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
pastels show N           full-pane render of [Image #N] (alt-screen, any-key to return)
pastels -s               pick a session, then show its gallery
pastels path N           print the stored file path for [Image #N]
pastels gc [--days 7]    prune images not seen in N days
pastels clear            panic: delete any stranded terminal graphics
```

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

## works great with [cc-clip](https://github.com/) <!-- link -->

cc-clip owns clipboard transport over SSH; pastels owns recall. cc-clip gets the
image *in*; pastels lets you *see it again*. They compose — use both.

## license

MIT
