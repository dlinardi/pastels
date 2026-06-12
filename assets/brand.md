# pastels brand

The identity leans into the name. Soft pastel colors on a dark terminal slate,
with the mark built from the `[Image #N]` brackets that pastels exists to reveal.

## Concept

The mark is the bracketed image. Two `[` `]` brackets (the opaque `[Image #N]`
reference) framing a soft pastel swatch that reads as a tiny picture (a sun and a
ridge). Brackets are the problem, the visible image is the product.

## Palette (anchored to the ghostty default, Tomorrow Night on slate)

| token   | hex       | use                                  |
| ------- | --------- | ------------------------------------ |
| slate   | `#282c34` | background, icon tile                 |
| ink     | `#c5c8c6` | brackets, secondary text              |
| paper   | `#eaeaea` | wordmark text                         |
| coral   | `#cc6666` | gradient start, warm accent           |
| lavender| `#b294bb` | gradient mid                          |
| mint    | `#8abeb7` | gradient end, cool accent             |
| butter  | `#f0c674` | optional accent                       |
| sky     | `#81a2be` | optional accent                       |
| sage    | `#b5bd68` | optional accent                       |

The swatch gradient runs coral to lavender to mint, a soft warm-to-cool blend
that evokes a row of pastel sticks and matches your terminal.

## Files

- `logo-mark.svg`   the mark on a transparent background, for inline and README use
- `logo-tile.svg`   the mark on a slate squircle, for the app icon, npm avatar, and favicon
- `wordmark.svg`    the mark plus the lowercase monospace wordmark

## Type

Lowercase monospace wordmark to signal a terminal tool. Good options are Berkeley
Mono, JetBrains Mono, Geist Mono, or Commit Mono. The SVG uses a font stack for
preview. For a stable final, open it in Figma or your design tool and outline the
text with your chosen font.

## Producing raster and social assets

- Icon PNG: export `logo-tile.svg` at 512x512 for npm and GitHub avatars, and
  16, 32, 180 for favicons.
- GitHub social preview: place the wordmark centered on a 1280x640 slate canvas
  and set it under repo Settings, General, Social preview.
- The strongest brand image for a visual tool is a real screenshot of
  `pastels show N` rendering an image in your terminal. Pair it with the mark.
