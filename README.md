# designer-mcp

Cursor-style **designer pen** for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Click, marquee, or draw on any webpage in a headed Chromium and Claude gets back the exact source file, line number, CSS selector, and a screenshot — ready to edit and verify.

## What it does

Three modes of visual-to-source:

| Mode | Interaction | Claude gets back |
|---|---|---|
| **element** | Hover + click one element | `{ selector, tag, classes, text, html, rect, source: { fileName, lineNumber, componentName }, screenshot_path }` |
| **area** | Drag a marquee | `{ rect, elements: [{ selector, source, rect, ... }], screenshot_path }` |
| **draw** | Freeform red pen, Enter to finish | `{ strokes, viewport, screenshot_path (pen only), viewport_screenshot_path (page + ink) }` |

All screenshots are saved as PNG files in `/tmp` and returned as paths — your MCP client never hits a context limit on base64.

React source resolution works in **Next.js dev mode** via the `_debugSource` fiber property (attached by `@babel/plugin-transform-react-jsx-source`). Production builds strip this; see [Production source mapping](#production-source-mapping) below.

## Demo

```
You:     "Make this button rounder"
Claude:  [designer_open http://localhost:3000/dashboard]
Claude:  [designer_pick mode=element]
You:     *click the button*
Claude:  → source: Button.tsx:42
Claude:  [Edit Button.tsx add rounded-full]
Claude:  [designer_screenshot selector=#cta-btn]  ← after screenshot for verification
```

## Install

Prereqs: Node 18+, [Claude Code](https://docs.anthropic.com/en/docs/claude-code), a working macOS/Linux (Playwright Chromium).

```bash
git clone https://github.com/YOUR_USER/designer-mcp.git
cd designer-mcp
npm install
npx playwright install chromium      # one-time browser download
```

Register the MCP with Claude Code (user-scope = available in every session):

```bash
claude mcp add --scope user designer-mcp node "$(pwd)/index.js"
```

Install the Claude skill so future sessions know the workflow:

```bash
mkdir -p ~/.claude/skills/designer
cp SKILL.md ~/.claude/skills/designer/SKILL.md
```

Restart Claude Code. You should see `designer_*` tools and a `designer:` skill in your session.

## Usage

Start your Next.js dev server (for source mapping):

```bash
cd your-nextjs-app && npm run dev
```

Then, in Claude Code:

> "Open http://localhost:3000/settings in the designer and let me pick the header."

Claude will call `designer_open(...)`, then `designer_pick({ mode: "element" })`. Chromium pops to the front, your cursor becomes crosshairs, you click the header. Claude gets `source.fileName` + `lineNumber` and can edit directly.

### Modes cheat sheet

- **Single element** — use `element`
- **Multiple related elements in one region** — use `area` (drag a box; returns every element whose center falls inside)
- **Annotate / explain visually** — use `draw` (red pen, Enter to finish, Esc to cancel)

## Production source mapping

`_debugSource` is dev-only. To use the picker on a production build, enable source maps in `next.config.js`:

```js
module.exports = {
  productionBrowserSourceMaps: true,
  // ...
};
```

The picker currently returns `source: null` in prod; a future version will resolve the selector through the deployed sourcemap. PRs welcome.

## Tool reference

All tools are exposed over MCP; Claude Code sees them as `mcp__designer-mcp__*`.

### `designer_open(url: string)`

Launch or reuse the headed Chromium instance and navigate. Foregrounds the window on macOS via `bringToFront()` + an AppleScript nudge.

### `designer_pick({ mode?: "element" | "area" | "draw" })`

Activate the picker overlay. Returns when the user completes the interaction (or Esc cancels, or 180s timeout).

### `designer_screenshot({ selector?: string })`

PNG of the page or a specific element. Returns `{ path, bytes }`.

### `designer_close()`

Tear down the browser and release Playwright resources.

## How it works

1. A Playwright-controlled Chromium is launched headed. Singleton per process.
2. `designer_pick` injects a small vanilla-JS overlay (`picker.js`) into the page. The overlay:
   - **element mode** — tracks `mousemove`/`click`, outlines the hover target in blue, resolves a unique-ish CSS selector, walks the React fiber chain for `_debugSource`, returns to the MCP.
   - **area mode** — rubber-band marquee; on mouseup, any element whose *center* falls inside the box is collected (dedup by selector).
   - **draw mode** — full-viewport canvas overlay; captures strokes as point arrays; Enter finishes.
3. The server polls `window.__designerResult` every 200ms for up to 180 seconds.
4. On completion, an appropriate screenshot (element / area clip / full viewport) is saved to `/tmp` and the path returned.

## Contributing

- PRs welcome, especially around:
  - Production sourcemap resolution
  - Kestrel/React Native picker (currently web only)
  - Multi-element accumulation in element mode (Cmd-click to add)
  - VS Code "reveal in editor" integration

## License

MIT
