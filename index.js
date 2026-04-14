#!/usr/bin/env node
/**
 * Designer MCP — click-to-select picker for Claude Code.
 *
 * Exposes four tools that drive a singleton headed Chromium:
 *   designer_open(url)          — launch/reuse browser, navigate to url
 *   designer_pick()             — inject overlay, wait for user click, return
 *                                 { selector, source, screenshot_base64, html }
 *   designer_screenshot([sel])  — PNG of page or specific element
 *   designer_close()            — tear down browser
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Picker source — plain JS function exported from picker.js, injected via
// p.evaluate(`(${source})(...args)`). Kept in a separate file to avoid the
// template-literal escape minefield.
const PICKER_SOURCE = readFileSync(join(__dirname, "picker.js"), "utf8")
  .replace(/^export\s+/m, ""); // strip ESM export keyword so it runs in browser as a plain fn decl

let browser = null;
let context = null;
let page = null;

function saveScreenshot(buf, label = "shot") {
  const path = join(tmpdir(), `designer-${label}-${Date.now()}.png`);
  writeFileSync(path, buf);
  return path;
}

async function ensurePage() {
  if (browser && page && !page.isClosed()) return page;
  browser = await chromium.launch({ headless: false });
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  page = await context.newPage();
  return page;
}

async function bringToFront(p) {
  try {
    await p.bringToFront();
  } catch {}
  // macOS: make sure the Chromium app window is actually frontmost.
  if (process.platform === "darwin") {
    try {
      const { execSync } = await import("node:child_process");
      execSync(
        `osascript -e 'tell application "System Events" to set frontmost of every process whose name contains "Chromium" to true'`,
        { timeout: 3000, stdio: "ignore" },
      );
    } catch {}
  }
}

async function designerOpen(url) {
  const p = await ensurePage();
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await bringToFront(p);
  return { opened: url, title: await p.title().catch(() => "") };
}

async function designerScreenshot(selector) {
  if (!page || page.isClosed()) throw new Error("No active page. Call designer_open first.");
  let buf;
  if (selector) {
    const el = await page.$(selector);
    if (!el) throw new Error(`Selector not found: ${selector}`);
    buf = await el.screenshot();
  } else {
    buf = await page.screenshot({ fullPage: false });
  }
  const path = saveScreenshot(buf, selector ? "element" : "page");
  return { path, bytes: buf.length };
}

async function designerVerify({ selector, before_path = null, wait_ms = 1500 }) {
  if (!selector) throw new Error("designer_verify requires { selector }");
  if (!page || page.isClosed()) throw new Error("No active page. Call designer_open first.");
  // Give HMR or deploy time to apply.
  await new Promise((r) => setTimeout(r, Math.max(0, Math.min(wait_ms, 30000))));
  const el = await page.$(selector);
  if (!el) throw new Error(`Selector not found after wait: ${selector}`);
  const afterBuf = await el.screenshot();
  const after_path = saveScreenshot(afterBuf, "verify-after");
  const result = { selector, before_path, after_path, after_bytes: afterBuf.length };
  if (before_path) {
    try {
      const { statSync, readFileSync } = await import("node:fs");
      const beforeBuf = readFileSync(before_path);
      result.before_bytes = beforeBuf.length;
      // Cheap "did it change" heuristic: identical bytes means unchanged.
      result.changed = beforeBuf.length !== afterBuf.length || !beforeBuf.equals(afterBuf);
    } catch (err) {
      result.compare_error = err.message;
    }
  }
  return result;
}

async function designerClose() {
  if (browser) await browser.close().catch(() => {});
  browser = context = page = null;
  return { closed: true };
}

// Picker logic lives in picker.js (readable, testable). Injected via PICKER_SOURCE.


async function designerPick(mode = "element") {
  if (!["element", "area", "draw"].includes(mode)) {
    throw new Error(`Invalid mode: ${mode}. Use element | area | draw.`);
  }
  const p = await ensurePage();
  await bringToFront(p);
  await p.evaluate(`(${PICKER_SOURCE})(${JSON.stringify(mode)});`);
  // Poll until window.__designerResult is set (or timeout).
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const result = await p.evaluate(() => window.__designerResult ?? null).catch(() => null);
    if (result) {
      await p.evaluate(() => { delete window.__designerResult; });
      if (result.cancelled) return { cancelled: true, mode: result.mode };

      // Capture a context screenshot appropriate to the mode.
      let screenshot_path = null;
      try {
        if (result.mode === "element" && result.selector) {
          const el = await p.$(result.selector);
          if (el) screenshot_path = saveScreenshot(await el.screenshot(), "pick-element");
        } else if (result.mode === "area" && result.rect) {
          screenshot_path = saveScreenshot(
            await p.screenshot({
              clip: {
                x: Math.max(0, result.rect.x),
                y: Math.max(0, result.rect.y),
                width: Math.max(1, result.rect.w),
                height: Math.max(1, result.rect.h),
              },
            }),
            "pick-area",
          );
        } else if (result.mode === "draw") {
          // Grab the drawn canvas image that the page stashed on the window.
          const dataUrl = await p.evaluate(() => {
            const d = window.__designerDrawCanvasData;
            delete window.__designerDrawCanvasData;
            return d || null;
          });
          if (dataUrl) {
            const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
            screenshot_path = saveScreenshot(Buffer.from(b64, "base64"), "pick-draw-strokes");
          }
          // Also grab a full-viewport screenshot so the caller has context.
          const viewportPath = saveScreenshot(await p.screenshot(), "pick-draw-viewport");
          result.viewport_screenshot_path = viewportPath;
        }
      } catch (err) {
        result.screenshot_error = err.message;
      }
      return { ...result, screenshot_path };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { error: "pick timed out after 180s" };
}

const server = new Server(
  { name: "designer-mcp", version: "0.2.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "designer_open",
      description:
        "Open a URL in the designer's headed Chromium (launches it if not running). Use this before designer_pick.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", description: "URL to navigate to" } },
        required: ["url"],
      },
    },
    {
      name: "designer_pick",
      description:
        "Activate the picker in the designer browser. Three modes:\n" +
        "  element — user clicks one element; returns { selector, tag, classes, text, html, rect, source, screenshot_path }\n" +
        "  area    — user drags a marquee; returns { rect, elements: [{selector, source, rect, ...}], screenshot_path }\n" +
        "  draw    — user ink-annotates with a red pen, Enter to finish; returns { strokes, viewport, screenshot_path (strokes only), viewport_screenshot_path (full view with drawings) }\n" +
        "Esc cancels in any mode. screenshot_path / viewport_screenshot_path point to PNGs in /tmp; open with the Read tool.",
      inputSchema: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["element", "area", "draw"],
            description: "element (default) = click one, area = drag marquee, draw = freeform pen",
          },
        },
      },
    },
    {
      name: "designer_verify",
      description:
        "After editing code based on a pick, call this to compare before/after. Waits briefly for HMR/deploy (default 1500ms), screenshots the same selector, returns { before_path, after_path, changed }. Pass the pick's screenshot_path as before_path to enable the change check.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector from a prior pick" },
          before_path: { type: "string", description: "The pick's screenshot_path" },
          wait_ms: { type: "number", description: "Milliseconds to wait before capturing (default 1500, max 30000)" },
        },
        required: ["selector"],
      },
    },
    {
      name: "designer_screenshot",
      description:
        "Screenshot the current page or a specific element selector. Returns { path, bytes } — a filesystem path to a PNG in /tmp that you can Read with the Read tool.",
      inputSchema: {
        type: "object",
        properties: { selector: { type: "string", description: "Optional CSS selector" } },
      },
    },
    {
      name: "designer_close",
      description: "Close the designer browser and release resources.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    let result;
    if (name === "designer_open") result = await designerOpen(args.url);
    else if (name === "designer_pick") result = await designerPick(args.mode);
    else if (name === "designer_screenshot") result = await designerScreenshot(args.selector);
    else if (name === "designer_verify") result = await designerVerify(args);
    else if (name === "designer_close") result = await designerClose();
    else throw new Error(`Unknown tool: ${name}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `ERROR: ${err.message}` }],
      isError: true,
    };
  }
});

process.on("SIGINT", async () => {
  await designerClose();
  process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[designer-mcp] connected via stdio");
