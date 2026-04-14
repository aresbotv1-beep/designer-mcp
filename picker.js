// Picker overlay — runs in the page via p.evaluate(). Supports three modes:
//   element: hover + click one element
//   area:    drag a marquee; returns every element whose center is inside
//   draw:    freeform pen on a canvas overlay; Enter to finish, Esc to cancel
//
// Exports ONE function: designerPicker(mode). Call at top level of p.evaluate
// by wrapping: `(${designerPickerSource})("element")`.
export function designerPicker(mode) {
  if (window.__designerPickActive) return;
  window.__designerPickActive = true;

  const style = document.createElement("style");
  style.id = "__designer-pick-style";
  style.textContent = [
    ".__designer-hover { outline: 2px solid #2563eb !important; outline-offset: 2px !important; cursor: crosshair !important; }",
    "#__designer-hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647; background: #111; color: #fff; font: 12px -apple-system, sans-serif; padding: 6px 12px; border-radius: 999px; pointer-events: none; box-shadow: 0 4px 20px rgba(0,0,0,.3); }",
    "#__designer-marquee { position: fixed; pointer-events: none; z-index: 2147483646; border: 2px dashed #2563eb; background: rgba(37,99,235,0.08); }",
    "#__designer-canvas { position: fixed; inset: 0; z-index: 2147483645; cursor: crosshair; }",
  ].join("\n");
  document.documentElement.appendChild(style);

  const hintMsg = {
    element: "Click any element to select — Esc to cancel",
    area: "Drag to select an area — Esc to cancel",
    draw: "Draw with the pen — Enter to finish, Esc to cancel",
  }[mode] || "Select — Esc to cancel";
  const hint = document.createElement("div");
  hint.id = "__designer-hint";
  hint.textContent = hintMsg;
  document.body.appendChild(hint);

  const selectorFor = (node) => {
    if (!(node instanceof Element)) return null;
    if (node.id) return "#" + CSS.escape(node.id);
    const parts = [];
    let cur = node;
    while (cur && cur.nodeType === 1 && parts.length < 5) {
      let part = cur.tagName.toLowerCase();
      if (cur.classList.length) {
        const cls = [...cur.classList].filter((c) => !c.startsWith("__designer")).slice(0, 2);
        if (cls.length) part += "." + cls.map((c) => CSS.escape(c)).join(".");
      }
      const parent = cur.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((s) => s.tagName === cur.tagName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(cur) + 1) + ")";
      }
      parts.unshift(part);
      if (cur.id) { parts[0] = "#" + CSS.escape(cur.id); break; }
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  };
  const reactSource = (node) => {
    if (!(node instanceof Element)) return null;
    const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
    if (!key) return null;
    let fiber = node[key];
    while (fiber) {
      if (fiber._debugSource) {
        return {
          fileName: fiber._debugSource.fileName,
          lineNumber: fiber._debugSource.lineNumber,
          columnNumber: fiber._debugSource.columnNumber || null,
          componentName: (fiber.type && (fiber.type.displayName || fiber.type.name)) || null,
        };
      }
      fiber = fiber.return;
    }
    return null;
  };
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    return {
      selector: selectorFor(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: [...el.classList].filter((c) => !c.startsWith("__designer")),
      text: (el.textContent || "").trim().slice(0, 120),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      source: reactSource(el),
    };
  };

  const listeners = [];
  const on = (target, type, fn) => {
    target.addEventListener(type, fn, true);
    listeners.push([target, type, fn]);
  };
  const cleanup = () => {
    listeners.forEach(([t, type, fn]) => t.removeEventListener(type, fn, true));
    document.querySelectorAll(".__designer-hover").forEach((el) => el.classList.remove("__designer-hover"));
    style.remove();
    hint.remove();
    const m = document.getElementById("__designer-marquee"); if (m) m.remove();
    const c = document.getElementById("__designer-canvas"); if (c) c.remove();
    window.__designerPickActive = false;
  };
  on(document, "keydown", (e) => {
    if (e.key === "Escape") { cleanup(); window.__designerResult = { mode, cancelled: true }; }
  });

  if (mode === "element") {
    let hovered = null;
    const setHover = (el) => {
      if (hovered) hovered.classList.remove("__designer-hover");
      hovered = el;
      if (el && el instanceof Element) el.classList.add("__designer-hover");
    };
    on(document, "mousemove", (e) => setHover(e.target));
    on(document, "click", (e) => {
      e.preventDefault(); e.stopPropagation();
      const el = e.target;
      cleanup();
      window.__designerResult = { mode: "element", ...describe(el), html: el.outerHTML.slice(0, 2000) };
    });
  }

  if (mode === "area") {
    let startX = 0, startY = 0, dragging = false;
    const marquee = document.createElement("div");
    marquee.id = "__designer-marquee";
    marquee.style.display = "none";
    document.body.appendChild(marquee);
    on(document, "mousedown", (e) => {
      if (e.target === marquee) return;
      e.preventDefault(); e.stopPropagation();
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      marquee.style.left = startX + "px";
      marquee.style.top = startY + "px";
      marquee.style.width = "0px";
      marquee.style.height = "0px";
      marquee.style.display = "block";
    });
    on(document, "mousemove", (e) => {
      if (!dragging) return;
      const x = Math.min(startX, e.clientX), y = Math.min(startY, e.clientY);
      const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
      marquee.style.left = x + "px"; marquee.style.top = y + "px";
      marquee.style.width = w + "px"; marquee.style.height = h + "px";
    });
    on(document, "mouseup", (e) => {
      if (!dragging) return;
      e.preventDefault(); e.stopPropagation();
      dragging = false;
      const rect = {
        x: parseFloat(marquee.style.left),
        y: parseFloat(marquee.style.top),
        w: parseFloat(marquee.style.width),
        h: parseFloat(marquee.style.height),
      };
      const all = document.querySelectorAll(
        "body *:not(#__designer-hint):not(#__designer-marquee):not(#__designer-pick-style)",
      );
      const picked = [];
      const seen = new Set();
      all.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
        if (cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h) {
          const info = describe(el);
          if (info.selector && !seen.has(info.selector)) {
            seen.add(info.selector);
            picked.push(info);
          }
        }
      });
      cleanup();
      window.__designerResult = { mode: "area", rect, elements: picked };
    });
  }

  if (mode === "draw") {
    const canvas = document.createElement("canvas");
    canvas.id = "__designer-canvas";
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    document.body.appendChild(canvas);

    const strokes = [];
    let currentStroke = null;
    let drawing = false;
    on(canvas, "mousedown", (e) => {
      drawing = true;
      currentStroke = [[Math.round(e.clientX), Math.round(e.clientY)]];
      ctx.beginPath();
      ctx.moveTo(e.clientX, e.clientY);
    });
    on(canvas, "mousemove", (e) => {
      if (!drawing) return;
      currentStroke.push([Math.round(e.clientX), Math.round(e.clientY)]);
      ctx.lineTo(e.clientX, e.clientY);
      ctx.stroke();
    });
    on(canvas, "mouseup", () => {
      if (!drawing) return;
      drawing = false;
      if (currentStroke && currentStroke.length > 1) strokes.push(currentStroke);
      currentStroke = null;
    });
    on(document, "keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        window.__designerDrawCanvasData = canvas.toDataURL("image/png");
        cleanup();
        window.__designerResult = {
          mode: "draw",
          strokes,
          viewport: { w: window.innerWidth, h: window.innerHeight },
        };
      }
    });
  }
}
