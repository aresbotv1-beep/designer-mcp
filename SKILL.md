---
name: designer
description: Visual click-to-edit workflow for Osprey/Kestrel. Use when Isaac asks to change, tweak, restyle, reposition, or critique anything visible on a page — also when he draws/annotates or says "this thing on the screen". Drives the headed-browser Designer MCP (designer_open, designer_pick, designer_screenshot, designer_close) and closes the loop with code edits + verification.
---

# Designer workflow

**Trigger:** any visual/design ask about Osprey or Kestrel — "make this button rounder", "move this", "redesign the header", "fix the spacing here", plus any time Isaac wants to draw/annotate on a page or use the picker directly.

## Tools this skill owns

These are Claude Code MCP tools (names start with `mcp__designer-mcp__`):

| Tool | Purpose |
|---|---|
| `designer_open(url)` | Launch/reuse headed Chromium, navigate |
| `designer_pick(mode?)` | Activate picker. Modes: `element` (default, click one), `area` (drag marquee), `draw` (red pen, Enter to finish) |
| `designer_screenshot(selector?)` | PNG of page or element. Returns `{ path }` — Read the path to see it |
| `designer_close()` | Tear down browser |

All screenshot returns are **filesystem paths to PNGs in `/tmp`** — use the Read tool to view them.

## Standard loop

```
1. Isaac describes a visual change
2. designer_open(<url>)          ← staging or http://localhost:3000 if dev is running
3. Ask which mode if ambiguous   ← element for one thing, area for a panel, draw for "this whole region"
4. designer_pick(mode)           ← user interacts in the browser
5. Read the screenshot_path      ← confirm you understand what was selected
6. If source.fileName is set:
     - Read the file at that line
     - Edit
     - Tell Isaac to refresh (dev mode: HMR auto-reloads; staging: deploy needed)
     - designer_screenshot(selector) to verify
   If source is null (prod build):
     - Use element.selector + html + text to grep the codebase for the matching markup
     - Offer to enable productionBrowserSourceMaps in next.config if staging source mapping matters
```

## Source mapping reality

- **Dev (`npm run dev`)**: React attaches `_debugSource` → pick returns exact file/line. This is the happy path.
- **Staging (osprey.whitelanewrx.com)**: prod build, `_debugSource` stripped → `source: null`. You must grep for the component by class names or text content.
- Fix for staging: add `productionBrowserSourceMaps: true` to `wrx-005/services/osprey/next.config.*` then teach the picker to resolve the selector through the deployed sourcemap. Not built yet — propose when Isaac hits this friction.

## Mode picking rules

- Single element, obvious target → `element`
- "this section", "this panel", multiple related elements → `area`
- Isaac wants to scribble a suggestion, arrow, circle → `draw`
- "lasso around these" — use `draw` (result is annotation only, no elements extracted — combine with a follow-up `area` pick if he wants elements)

## Gotchas

- **The Chromium window may hide behind VS Code.** The MCP calls `bringToFront()` + an osascript nudge, but on multi-display setups it can still land on the wrong screen. If Isaac says "nothing happened," check Mission Control.
- **Esc cancels any mode.** If a pick hangs and the user walked away, call `designer_close()` to reset.
- **Draw mode's Enter key** finishes the stroke capture. Users sometimes hit Return in a text field instead — if no result comes back after 90s, remind him.
- **One browser session is shared.** `designer_open` on a new URL navigates the same tab. This is usually what you want, but call `designer_close()` first if state might be corrupted (e.g., wrong auth).
- **Screenshots are paths, not base64.** Always Read them; do NOT try to embed the JSON response as an image.

## Closing the loop — verification

After any edit driven by a pick:
1. Save the "before" screenshot_path from the pick response.
2. Make the Edit.
3. Wait briefly (dev HMR ~1s; staging requires deploy).
4. Call `designer_screenshot(selector)` for the same element.
5. Compare: show both paths to Isaac or describe the visible delta.

Don't claim the change shipped without the after-screenshot.

## Memory breadcrumbs

Related memory files to consult when the user hits an infra/deploy question mid-session:
- `reference_designer_mcp.md` — tool spec + location
- `reference_osprey_deploy.md` — droplet pipeline, symlinks, webhook behavior

## What this skill does NOT cover

- **Pure code refactors** with no visual component — just use Read/Edit directly.
- **Large multi-file redesigns** — use the frontend-design skill, then this one for the surgical iterations.
- **Non-Osprey/Kestrel surfaces** — the source mapping assumes Next.js dev builds.
