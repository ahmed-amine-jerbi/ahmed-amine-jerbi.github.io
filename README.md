# ahmed-amine-jerbi.github.io

Personal site and CV of Ahmed Amine Jerbi, Business Information Systems student at ESEN (Université de la
Manouba).

Live at https://ahmed-amine-jerbi.github.io/

## What's here

| Path | What it is |
|---|---|
| `index.html`, `css/site.css` | The page. Static HTML and CSS, no build step. |
| `js/stack-scene.js` | The 3D layer stack beside the page (Three.js). Draws whatever `pose` says, and nothing while it is hidden. |
| `js/main.js` | Scroll choreography (GSAP ScrollTrigger, Lenis): moves the stack, lights one layer per skill group, parallax (`data-speed`), reveals (`data-reveal`, `data-reveal-group`, `data-split`), counters (`data-count`), the ReturnFlow diagram. |
| `js/site.bundle.js` | Built from the two files above by `npm run build`. The page loads this, never edit it by hand. |
| `vendor/` | Three.js r170 (plus `RoundedBoxGeometry` and `RoomEnvironment` from its examples, in `vendor/three-addons/`), GSAP 3.12.5 and Lenis 1.1.13, copied from npm so the site has no CDN dependency. |
| `cv/` | The CV PDFs the site links to, in English and French. |
| `cv/source/` | The CV sources (HTML + print CSS). Edit these, never the PDFs. |
| `cv/source/fonts/` | Source Serif 4 (Regular, Italic, SemiBold), static instances from Fontsource, SIL Open Font License (`OFL.txt`). |
| `tools/render-cv.mjs` | Turns the CV sources into the PDFs. |

## Run it locally

Open `index.html` in a browser, or serve the folder:

```sh
python -m http.server 8000
# open http://localhost:8000
```

After changing anything in `js/`, rebuild the bundle the page loads:

```sh
npm install
npm run build
```

## Update the CV

1. Edit `cv/source/cv-en.html` and `cv/source/cv-fr.html` (keep both in step).
2. Render the PDFs (uses the installed Microsoft Edge):

   ```sh
   npm install
   npm run cv
   ```

   The script prints the page count and size of each PDF and warns if one runs past a page. It
   also removes the Creator and Producer that Edge stamps on every PDF ("HeadlessChrome ... Edg/",
   "Skia/PDF"), so the document properties show only the title, author and dates.

Keep the CV fonts static (one file per weight and style). Edge embeds a variable font as Type 3
outlines, which made the PDFs about five times larger (230 KB instead of 50 KB).

## Accessibility and motion

- With "reduce motion" turned on in the OS, nothing scrubs or spins: the stack stays still behind the
  first screen and every skill group is shown at once.
- If WebGL is unavailable, the canvas and its zoom controls are hidden and the page works without them.
- The 3D view spins on its own and stops while you drag it. Zoom with the on-screen buttons, a
  double-click, a pinch (or Ctrl + wheel) over the stack, or the + / - / 0 keys. Clicking a layer
  scrolls to that skill group.
- The site is dark only; the 3D scene reads its colours (`--sea`, `--saffron`) from the same CSS variables.

## Deploy

Push to the `main` branch of a GitHub repository named `ahmed-amine-jerbi.github.io`, then in
**Settings > Pages** choose "Deploy from a branch", branch `main`, folder `/ (root)`.

## Performance rules (measured, keep them)

Each of these removed a visible freeze when scrolling (Edge, Windows, measured with Playwright):

- No `backdrop-filter` over the WebGL canvas: the blur is redone every frame.
- No gradients and no rounded clipping (`overflow: hidden` with a radius) on things that first appear
  far down the page: the GPU compiles a new shader on first sight (150 to 250 ms). Use solid colours
  and pseudo-elements, and small radii without clipping.
- Few font instances. Archivo is variable; each new weight and width pair costs a font build on first
  use. The pairs in use are 400, 600 (width 100), 650/118, 700/118 and 750/125, and `.font-warmup`
  draws each once at load.
- The intro starts only after the fonts, the 3D shaders and the screenshots are ready
  (`startWhenReady` in `main.js`), and never calls `ScrollTrigger.refresh()` itself.
- Parallax targets carry `will-change: transform` (set in CSS); the very wide ticker rows must not.
