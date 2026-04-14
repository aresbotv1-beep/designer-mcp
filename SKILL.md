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
| `designer_open(url)` | Launch/reuse headed Chromium, navigate, foreground window |
| `designer_pick(mode?)` | Activate picker. Modes: `element` (default; Cmd/Shift-click for multi, Enter to finish), `area` (drag marquee), `draw` (red pen, Cmd-Z undo, type a label, Enter to finish) |
| `designer_verify({ selector, before_path?, wait_ms? })` | After editing, wait for HMR/deploy, re-screenshot the same selector, return `{ before_path, after_path, changed }`. Call this to close the loop instead of blindly claiming the change shipped. |
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

- **Dev (`npm run dev`)**: React attaches `_debugSource` → pick returns `source.fileName` + `lineNumber`. `source.hint === "dev-source"`. Happy path — read the file, edit, done.
- **Staging/prod**: `_debugSource` stripped. Pick still returns `source.componentName` + `source.componentChain` (the nearest function-component names in the fiber ancestry) with `source.hint === "prod-fallback"`. **Grep the codebase for `componentName` or any name in `componentChain`** to find the source. Example: if `componentName: "PhaseBlock"`, run `grep -rl "export.*PhaseBlock\|function PhaseBlock" src/`.
- Full prod sourcemap resolution (bundle line/col → .tsx line/col) is not built yet. Propose enabling `productionBrowserSourceMaps: true` in next.config if Isaac hits the friction.

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

After any edit driven by a pick, **call `designer_verify`** — do not claim a visual change shipped without it.

```
1. Pick returned { selector, screenshot_path }. Save both.
2. Read the source file, Edit.
3. designer_verify({ selector, before_path: <pick.screenshot_path>, wait_ms: 1500 })
   ↳ returns { before_path, after_path, changed: bool }
4. If changed=false: the HMR hasn't applied (or the edit didn't actually move the DOM). Re-verify with higher wait_ms (dev ≤3000, staging 60000+ after a deploy), or re-read the screenshots yourself.
5. Read the after_path PNG to visually confirm the change matches intent.
```

For area-mode edits (multiple elements changed), call `designer_verify` on each affected selector in parallel, or just `designer_screenshot` the containing region.

## Memory breadcrumbs

Related memory files to consult when the user hits an infra/deploy question mid-session:
- `reference_designer_mcp.md` — tool spec + location
- `reference_osprey_deploy.md` — droplet pipeline, symlinks, webhook behavior

## What this skill does NOT cover

- **Pure code refactors** with no visual component — just use Read/Edit directly.
- **Large multi-file redesigns** — use the frontend-design skill, then this one for the surgical iterations.
- **Non-Osprey/Kestrel surfaces** — the source mapping assumes Next.js dev builds.
