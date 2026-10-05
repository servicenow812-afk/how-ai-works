/* How AI Works — interactive visual guide. Plain JS, no dependencies. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function svgEl(tag, attrs = {}, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }

  function softmax(scores, temp = 1) {
    const m = Math.max(...scores);
    const ex = scores.map((s) => Math.exp((s - m) / temp));
    const sum = ex.reduce((a, b) => a + b, 0);
    return ex.map((e) => e / sum);
  }

  function renderBars(container, items, pickedName) {
    container.innerHTML = "";
    for (const { name, p } of items) {
      const row = document.createElement("div");
      row.className = "bar" + (name === pickedName ? " picked" : "");
      row.innerHTML = `<span class="name"></span><span class="track"><span class="fill" style="width:0"></span></span><span class="pct">${(p * 100).toFixed(1)}%</span>`;
      row.querySelector(".name").textContent = name;
      container.appendChild(row);
      requestAnimationFrame(() => { row.querySelector(".fill").style.width = (p * 100).toFixed(2) + "%"; });
    }
  }

  /* ---------------- Theme ---------------- */
  const redrawers = [];
  $("themeToggle").addEventListener("click", () => {
    const root = document.documentElement;
    const isLight = root.dataset.theme
      ? root.dataset.theme === "light"
      : window.matchMedia("(prefers-color-scheme: light)").matches;
    root.dataset.theme = isLight ? "dark" : "light";
    try { localStorage.setItem("theme", root.dataset.theme); } catch (e) { /* storage unavailable */ }
    redrawers.forEach((fn) => fn());
  });
  try {
    const saved = localStorage.getItem("theme");
    if (saved) document.documentElement.dataset.theme = saved;
  } catch (e) { /* storage unavailable */ }

  /* ---------------- Scroll reveal ---------------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("visible"); });
  }, { threshold: 0.12 });
  document.querySelectorAll(".step").forEach((s) => io.observe(s));

  /* ---------------- Background network ---------------- */
  (function background() {
    const c = $("bg");
    const ctx = c.getContext("2d");
    let pts = [], w, h;
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      w = window.innerWidth; h = window.innerHeight;
      c.width = w * dpr; c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(clamp((w * h) / 22000, 25, 80));
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
      }));
    }
    function frame() {
      ctx.clearRect(0, 0, w, h);
      const accent = cssVar("--accent");
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }
      ctx.strokeStyle = accent;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
          if (d < 140) {
            ctx.globalAlpha = (1 - d / 140) * 0.35;
            ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = accent;
      for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (!reduceMotion) requestAnimationFrame(frame);
    }
    resize();
    window.addEventListener("resize", () => { resize(); if (reduceMotion) frame(); });
    frame();
  })();

  /* ================= 1. Tokenizer ================= */
  const PREFIXES = ["under", "over", "dis", "pre", "un", "re"];
  const SUFFIXES = ["ably", "ibly", "tion", "ness", "ment", "less", "ful", "ing", "est", "ed", "ly", "er", "s"];

  function splitWord(word) {
    if (word.length <= 6) return [word];
    const pieces = [];
    let core = word;
    const lower = () => core.toLowerCase();
    for (const p of PREFIXES) {
      if (lower().startsWith(p) && core.length - p.length >= 4) { pieces.push(core.slice(0, p.length)); core = core.slice(p.length); break; }
    }
    let suffix = "";
    for (const s of SUFFIXES) {
      if (lower().endsWith(s) && core.length - s.length >= 3) { suffix = core.slice(core.length - s.length); core = core.slice(0, core.length - s.length); break; }
    }
    while (core.length > 7) { pieces.push(core.slice(0, 5)); core = core.slice(5); }
    if (core) pieces.push(core);
    if (suffix) pieces.push(suffix);
    return pieces;
  }

  function tokenize(text) {
    const out = [];
    const re = /(\s*)([A-Za-z]+|\d{1,3}|[^\sA-Za-z\d])/g;
    let m;
    while ((m = re.exec(text))) {
      const space = m[1] ? " " : "";
      const parts = /[A-Za-z]/.test(m[2]) ? splitWord(m[2]) : [m[2]];
      parts.forEach((p, i) => out.push((i === 0 ? space : "") + p));
    }
    return out;
  }

  function renderTokens() {
    const text = $("tokInput").value;
    const toks = tokenize(text);
    const box = $("tokChips");
    box.innerHTML = "";
    toks.forEach((t, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.style.setProperty("--h", (hash(t) % 360).toString());
      chip.style.animationDelay = Math.min(i * 25, 600) + "ms";
      const tt = document.createElement("span");
      tt.className = "t";
      tt.textContent = t.replace(/^ /, "·");
      const id = document.createElement("span");
      id.className = "id";
      id.textContent = hash(t.toLowerCase()) % 100000;
      chip.append(tt, id);
      box.appendChild(chip);
    });
    $("tokCount").textContent = toks.length;
    $("charCount").textContent = text.length;
    $("ratio").textContent = toks.length ? (text.length / toks.length).toFixed(1) : "0";
  }
  $("tokInput").addEventListener("input", renderTokens);
  renderTokens();

  /* ================= 2. Embeddings ================= */
  const GROUPS = {
    animals: { color: "#22d3ee", label: "Animals" },
    people: { color: "#a78bfa", label: "People & royalty" },
    food: { color: "#fb923c", label: "Food" },
    feelings: { color: "#f472b6", label: "Feelings" },
    tech: { color: "#4ade80", label: "Technology" },
    unknown: { color: "#94a3b8", label: "Not in our tiny vocab (guessed)" },
  };
  const EMB = {
    cat: [-0.7, 0.6, "animals"], dog: [-0.58, 0.7, "animals"], kitten: [-0.8, 0.5, "animals"],
    puppy: [-0.66, 0.82, "animals"], horse: [-0.45, 0.52, "animals"], lion: [-0.6, 0.4, "animals"],
    bird: [-0.85, 0.74, "animals"], fish: [-0.88, 0.36, "animals"],
    king: [0.55, 0.65, "people"], queen: [0.75, 0.62, "people"], man: [0.45, 0.35, "people"],
    woman: [0.65, 0.32, "people"], prince: [0.5, 0.8, "people"], princess: [0.72, 0.78, "people"],
    boy: [0.38, 0.2, "people"], girl: [0.58, 0.17, "people"],
    pizza: [-0.6, -0.55, "food"], pasta: [-0.72, -0.44, "food"], burger: [-0.48, -0.66, "food"],
    apple: [-0.38, -0.4, "food"], bread: [-0.64, -0.74, "food"], cheese: [-0.8, -0.62, "food"],
    happy: [0.52, -0.42, "feelings"], joy: [0.64, -0.32, "feelings"], love: [0.72, -0.5, "feelings"],
    sad: [0.36, -0.66, "feelings"], angry: [0.24, -0.54, "feelings"], tired: [0.32, -0.8, "feelings"],
    computer: [0.02, -0.12, "tech"], code: [0.14, -0.02, "tech"], robot: [-0.12, 0.06, "tech"],
    ai: [0.06, 0.12, "tech"], phone: [-0.06, -0.22, "tech"], internet: [0.18, -0.2, "tech"],
  };
  const clean = (w) => w.toLowerCase().replace(/[^a-z]/g, "");
  function embedOf(word) {
    const w = clean(word);
    if (EMB[w]) return { x: EMB[w][0], y: EMB[w][1], group: EMB[w][2], known: true };
    const h = hash(w);
    return { x: ((h % 1000) / 1000 - 0.5) * 0.5, y: (((h >> 10) % 1000) / 1000 - 0.5) * 0.5, group: "unknown", known: false };
  }

  const EP = { w: 600, h: 440, pad: 36 };
  const ex = (x) => EP.pad + ((x + 1) / 2) * (EP.w - EP.pad * 2);
  const ey = (y) => EP.h - EP.pad - ((y + 1) / 2) * (EP.h - EP.pad * 2);
  let analogyOn = false;

  function fakeVector(word, x, y) {
    const h = hash(word);
    const extra = [0, 1, 2, 3].map((i) => (((h >> (i * 7)) % 200) / 100 - 1).toFixed(2));
    return `[${x.toFixed(2)}, ${y.toFixed(2)}, ${extra.join(", ")}, … ×4096]`;
  }

  function renderEmbeddings() {
    const svg = $("embedPlot");
    svg.innerHTML = "";
    const grid = svgEl("g", { class: "grid" }, svg);
    for (let i = 0; i <= 8; i++) {
      const gx = EP.pad + (i / 8) * (EP.w - EP.pad * 2);
      const gy = EP.pad + (i / 8) * (EP.h - EP.pad * 2);
      svgEl("line", { x1: gx, y1: EP.pad, x2: gx, y2: EP.h - EP.pad, "stroke-width": 1 }, grid);
      svgEl("line", { x1: EP.pad, y1: gy, x2: EP.w - EP.pad, y2: gy, "stroke-width": 1 }, grid);
    }
    const highlight = new Set($("embedInput").value.split(/\s+/).map(clean).filter(Boolean));
    if (analogyOn) ["king", "man", "woman", "queen"].forEach((w) => highlight.add(w));
    const anyHi = highlight.size > 0;

    const points = Object.keys(EMB).map((w) => ({ word: w, ...embedOf(w) }));
    highlight.forEach((w) => { if (!EMB[w]) points.push({ word: w, ...embedOf(w) }); });

    const info = $("embedInfo");
    for (const p of points) {
      const hi = highlight.has(p.word);
      const g = svgEl("g", {}, svg);
      const dot = svgEl("circle", {
        class: "dot", cx: ex(p.x), cy: ey(p.y), r: hi ? 8 : 5,
        fill: GROUPS[p.group].color, opacity: anyHi && !hi ? 0.28 : 0.95,
        stroke: hi ? cssVar("--text") : "none", "stroke-width": 2,
      }, g);
      const lbl = svgEl("text", {
        class: "lbl", x: ex(p.x) + 10, y: ey(p.y) + 4,
        opacity: anyHi && !hi ? 0.35 : 1, "font-weight": hi ? 700 : 400,
      }, g);
      lbl.textContent = p.word;
      const show = () => {
        info.textContent = `"${p.word}" → ${fakeVector(p.word, p.x, p.y)}` + (p.known ? "" : "  (unknown word: position guessed)");
        dot.setAttribute("r", 10);
      };
      g.addEventListener("mouseenter", show);
      g.addEventListener("click", show);
      g.addEventListener("mouseleave", () => dot.setAttribute("r", hi ? 8 : 5));
    }

    if (analogyOn) {
      const defs = svgEl("defs", {}, svg);
      const marker = svgEl("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
      svgEl("path", { d: "M0,0 L10,5 L0,10 z", fill: cssVar("--accent-3") }, marker);
      const arrow = (a, b, delay) => {
        const [x1, y1] = [ex(EMB[a][0]), ey(EMB[a][1])];
        const [x2, y2] = [ex(EMB[b][0]), ey(EMB[b][1])];
        const len = Math.hypot(x2 - x1, y2 - y1);
        const shrink = (len - 12) / len;
        const line = svgEl("line", {
          x1, y1, x2: x1 + (x2 - x1) * shrink, y2: y1 + (y2 - y1) * shrink,
          stroke: cssVar("--accent-3"), "stroke-width": 3, "marker-end": "url(#arrow)",
          "stroke-dasharray": len, "stroke-dashoffset": len,
        }, svg);
        line.style.transition = `stroke-dashoffset 0.9s ease ${delay}s`;
        requestAnimationFrame(() => requestAnimationFrame(() => line.setAttribute("stroke-dashoffset", 0)));
      };
      arrow("man", "woman", 0);
      arrow("king", "queen", 0.9);
      info.textContent = "The direction man → woman is the same as king → queen. So king − man + woman lands right on queen. Models learn these relationships without being told!";
    }

    const legend = $("embedLegend");
    legend.innerHTML = "";
    for (const k in GROUPS) {
      const s = document.createElement("span");
      s.innerHTML = `<i style="background:${GROUPS[k].color}"></i>`;
      s.append(GROUPS[k].label);
      legend.appendChild(s);
    }
  }
  $("embedInput").addEventListener("input", () => { analogyOn = false; renderEmbeddings(); });
  $("analogyBtn").addEventListener("click", () => { analogyOn = !analogyOn; renderEmbeddings(); });
  redrawers.push(renderEmbeddings);
  renderEmbeddings();

  /* ================= 3. Attention ================= */
  const PRONOUNS = new Set(["it", "he", "she", "they", "him", "her", "them", "its", "his", "their", "this"]);
  const FUNCTION = new Set(["the", "a", "an", "on", "in", "at", "of", "to", "and", "or", "but", "because", "was", "is", "are", "were", "be", "with", "for", "by", "from", "so", "that", "very"]);
  const ANIMATE = new Set(["animals", "people"]);
  let attHead = 0;
  let attActive = -1;
  let attWords = [];

  function isNounish(w) {
    const c = clean(w);
    if (!c || PRONOUNS.has(c) || FUNCTION.has(c)) return false;
    if (EMB[c]) return EMB[c][2] !== "feelings";
    return !/(ed|ly|ing)$/.test(c);
  }

  function attentionRow(i) {
    const words = attWords.map(clean);
    const scores = [];
    for (let j = 0; j <= i; j++) {
      let s = 0;
      const d = i - j;
      if (attHead === 0) {
        s = -1.1 * d + (d === 1 ? 1.4 : 0) + (d === 0 ? 0.6 : 0);
      } else if (attHead === 1) {
        const a = EMB[words[i]], b = EMB[words[j]];
        if (d === 0) s = 1.5;
        else if (a && b) s = 3.2 - 3.0 * Math.hypot(a[0] - b[0], a[1] - b[1]) + (a[2] === b[2] ? 1 : 0);
        else if (FUNCTION.has(words[j])) s = -2;
        else s = 0;
      } else {
        if (PRONOUNS.has(words[i])) {
          if (isNounish(attWords[j]) && d > 0) {
            const g = EMB[words[j]] ? EMB[words[j]][2] : "";
            s = 3 + (ANIMATE.has(g) ? 2 : 0) - 0.08 * d - (j > 0 && words[j - 1] === "on" ? 1 : 0);
          } else s = d === 0 ? 0.5 : -1.5;
        } else {
          s = d === 0 ? 2 : j === 0 ? 1.2 : -1;
        }
      }
      scores.push(s);
    }
    return softmax(scores);
  }

  function renderAttention() {
    const svg = $("attSvg");
    svg.innerHTML = "";
    const n = attWords.length;
    if (!n) return;
    const charW = 9.6, padX = 14, gap = 10, baseY = 210;
    const widths = attWords.map((w) => Math.max(w.length * charW + padX * 2, 34));
    const total = widths.reduce((a, b) => a + b, 0) + gap * (n - 1);
    const vbW = Math.max(svg.clientWidth < 600 ? 560 : 900, total + 20);
    svg.setAttribute("viewBox", `0 0 ${vbW} 260`);
    let x = (vbW - total) / 2;
    const centers = [];
    const groups = [];
    attWords.forEach((w, i) => {
      const g = svgEl("g", { class: "word" + (i === attActive ? " active" : ""), tabindex: 0, role: "button", "aria-label": `Show attention for ${w}` }, svg);
      svgEl("rect", { x, y: baseY, width: widths[i], height: 36, rx: 9 }, g);
      const t = svgEl("text", { x: x + widths[i] / 2, y: baseY + 24, "text-anchor": "middle" }, g);
      t.textContent = w;
      centers.push(x + widths[i] / 2);
      const activate = () => { attActive = i; renderAttention(); };
      g.addEventListener("mouseenter", activate);
      g.addEventListener("click", activate);
      g.addEventListener("focus", activate);
      groups.push(g);
      x += widths[i] + gap;
    });

    const row = attentionRow(attActive);
    const arcLayer = svgEl("g", {}, svg);
    svg.insertBefore(arcLayer, svg.firstChild);
    row.forEach((wgt, j) => {
      if (j === attActive) {
        svgEl("circle", { cx: centers[j], cy: baseY - 10, r: 4 + 14 * wgt, fill: cssVar("--accent-2"), opacity: 0.2 + 0.8 * wgt }, arcLayer);
        return;
      }
      const x1 = centers[attActive], x2 = centers[j];
      const hgt = Math.min(185, 30 + Math.abs(x1 - x2) * 0.42);
      svgEl("path", {
        d: `M ${x1} ${baseY - 2} C ${x1} ${baseY - hgt}, ${x2} ${baseY - hgt}, ${x2} ${baseY - 2}`,
        "stroke-width": 1 + 13 * wgt, opacity: 0.12 + 0.88 * wgt,
      }, arcLayer);
    });

    const items = row.map((p, j) => ({ name: attWords[j], p, j })).sort((a, b) => b.p - a.p).slice(0, 6);
    renderBars($("attBars"), items.map(({ name, p, j }) => ({ name: j === attActive ? name + " (self)" : name, p })));

    const mat = $("attMatrix");
    mat.innerHTML = "";
    mat.style.gridTemplateColumns = `70px repeat(${n}, minmax(18px, 1fr))`;
    const accent = cssVar("--accent-2");
    mat.appendChild(document.createElement("div")).className = "lab";
    attWords.forEach((w) => { const d = document.createElement("div"); d.className = "lab collab"; d.textContent = w; mat.appendChild(d); });
    for (let i = 0; i < n; i++) {
      const r = attentionRow(i);
      const lab = document.createElement("div");
      lab.className = "lab rowlab";
      lab.textContent = attWords[i];
      if (i === attActive) lab.style.color = cssVar("--accent");
      mat.appendChild(lab);
      for (let j = 0; j < n; j++) {
        const cell = document.createElement("div");
        const v = j <= i ? r[j] : 0;
        cell.style.background = j <= i ? `color-mix(in srgb, ${accent} ${Math.round(v * 100)}%, transparent)` : "transparent";
        if (j <= i) cell.style.outline = `1px solid ${cssVar("--border")}`;
        if (i === attActive) cell.style.outlineColor = cssVar("--accent");
        cell.title = j <= i ? `${attWords[i]} → ${attWords[j]}: ${(v * 100).toFixed(0)}%` : "can't look at future words";
        mat.appendChild(cell);
      }
    }
  }

  function setAttSentence() {
    attWords = $("attInput").value.split(/\s+/).filter(Boolean).slice(0, 16);
    const itIdx = attWords.findIndex((w) => PRONOUNS.has(clean(w)));
    attActive = itIdx >= 0 ? itIdx : attWords.length - 1;
    renderAttention();
  }
  $("attInput").addEventListener("input", setAttSentence);
  document.querySelectorAll("#headSeg button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#headSeg button").forEach((o) => { o.classList.toggle("on", o === b); o.setAttribute("aria-checked", o === b); });
    attHead = Number(b.dataset.head);
    renderAttention();
  }));
  redrawers.push(renderAttention);
  setAttSentence();

  /* ================= 4. Neural network ================= */
  const NET_SIZES = [3, 5, 5, 3];
  const IN_NAMES = ["Furry", "Barks", "Can fly"];
  const OUT_NAMES = ["cat", "dog", "bird"];
  let net = null;
  const netInputs = [0.9, 0.1, 0.0];
  let pulseT = NET_SIZES.length; // fully lit

  function initNet() {
    net = [];
    for (let l = 0; l < NET_SIZES.length - 1; l++) {
      const W = [], b = [];
      for (let j = 0; j < NET_SIZES[l + 1]; j++) {
        W.push(Array.from({ length: NET_SIZES[l] }, () => (Math.random() * 2 - 1) * 1.2));
        b.push((Math.random() * 2 - 1) * 0.3);
      }
      net.push({ W, b });
    }
  }

  function forward(x) {
    const acts = [x];
    let a = x;
    net.forEach((layer, l) => {
      const z = layer.W.map((row, j) => row.reduce((s, w, k) => s + w * a[k], layer.b[j]));
      a = l === net.length - 1 ? softmax(z) : z.map(Math.tanh);
      acts.push(a);
    });
    return acts;
  }

  function sample() {
    const r = Math.random;
    const k = Math.floor(r() * 3);
    if (k === 0) return [[0.75 + r() * 0.25, r() * 0.25, r() * 0.15], 0];
    if (k === 1) return [[0.6 + r() * 0.4, 0.65 + r() * 0.35, r() * 0.15], 1];
    return [[r() * 0.35, r() * 0.2, 0.65 + r() * 0.35], 2];
  }

  function trainNet(steps = 3000, lr = 0.08) {
    for (let s = 0; s < steps; s++) {
      const [x, y] = sample();
      const acts = forward(x);
      let delta = acts[acts.length - 1].map((p, i) => p - (i === y ? 1 : 0));
      for (let l = net.length - 1; l >= 0; l--) {
        const aPrev = acts[l];
        const layer = net[l];
        const prevDelta = l > 0 ? aPrev.map((av, k) => (1 - av * av) * layer.W.reduce((sum, row, j) => sum + row[k] * delta[j], 0)) : null;
        layer.W.forEach((row, j) => row.forEach((_, k) => { row[k] -= lr * delta[j] * aPrev[k]; }));
        layer.b.forEach((_, j) => { layer.b[j] -= lr * delta[j]; });
        delta = prevDelta;
      }
    }
  }

  const netCanvas = $("netCanvas");
  const nctx = netCanvas.getContext("2d");

  function netLayout() {
    const W = netCanvas.clientWidth || 640;
    const H = W * (400 / 640);
    const dpr = window.devicePixelRatio || 1;
    if (netCanvas.width !== Math.round(W * dpr)) {
      netCanvas.width = Math.round(W * dpr);
      netCanvas.height = Math.round(H * dpr);
    }
    nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const padL = W * 0.16, padR = W * 0.14;
    return NET_SIZES.map((n, l) => {
      const x = padL + (l / (NET_SIZES.length - 1)) * (W - padL - padR);
      return Array.from({ length: n }, (_, i) => ({ x, y: H * ((i + 1) / (n + 1)) }));
    }).concat([{ W, H }]);
  }

  function drawNet() {
    const layout = netLayout();
    const { W, H } = layout.pop();
    const acts = forward(netInputs);
    nctx.clearRect(0, 0, W, H);
    const pos = cssVar("--pos"), neg = cssVar("--neg"), text = cssVar("--text"), muted = cssVar("--muted"), accent = cssVar("--accent");
    const r = Math.max(9, W / 45);

    for (let l = 0; l < net.length; l++) {
      const lit = clamp(pulseT - l, 0, 1);
      net[l].W.forEach((row, j) => row.forEach((w, k) => {
        const a = layout[l][k], b = layout[l + 1][j];
        nctx.strokeStyle = w >= 0 ? pos : neg;
        nctx.globalAlpha = clamp(Math.abs(w) / 3, 0.06, 0.8) * (0.35 + 0.65 * lit);
        nctx.lineWidth = 0.5 + Math.min(Math.abs(w), 3);
        nctx.beginPath(); nctx.moveTo(a.x, a.y); nctx.lineTo(b.x, b.y); nctx.stroke();
        if (lit > 0 && lit < 1) {
          const px = a.x + (b.x - a.x) * lit, py = a.y + (b.y - a.y) * lit;
          nctx.globalAlpha = Math.min(1, Math.abs(acts[l][k]) + 0.2);
          nctx.fillStyle = w >= 0 ? pos : neg;
          nctx.beginPath(); nctx.arc(px, py, 3, 0, Math.PI * 2); nctx.fill();
        }
      }));
    }
    nctx.globalAlpha = 1;

    layout.forEach((layer, l) => {
      const on = pulseT >= l;
      layer.forEach((p, i) => {
        const a = Math.abs(acts[l][i]);
        const v = on ? clamp(a, 0, 1) : 0;
        nctx.beginPath(); nctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        nctx.fillStyle = cssVar("--bg-2"); nctx.fill();
        nctx.globalAlpha = 0.15 + 0.85 * v;
        nctx.fillStyle = accent; nctx.fill();
        nctx.globalAlpha = 1;
        if (v > 0.5) { nctx.shadowColor = accent; nctx.shadowBlur = 18 * v; }
        nctx.lineWidth = 1.5; nctx.strokeStyle = accent; nctx.stroke();
        nctx.shadowBlur = 0;
      });
    });

    nctx.font = `600 ${Math.max(11, W / 52)}px Inter, sans-serif`;
    nctx.textBaseline = "middle";
    nctx.fillStyle = text;
    nctx.textAlign = "right";
    layout[0].forEach((p, i) => nctx.fillText(IN_NAMES[i], p.x - r - 8, p.y));
    nctx.textAlign = "left";
    const last = layout[layout.length - 1];
    last.forEach((p, i) => {
      nctx.fillStyle = pulseT >= NET_SIZES.length - 1 ? text : muted;
      nctx.fillText(OUT_NAMES[i], p.x + r + 8, p.y);
    });
    nctx.fillStyle = muted;
    nctx.textAlign = "center";
    nctx.font = `500 ${Math.max(10, W / 64)}px Inter, sans-serif`;
    ["input", "hidden 1", "hidden 2", "output"].forEach((s, l) => nctx.fillText(s, layout[l][0].x, H - 10));

    const out = acts[acts.length - 1];
    const best = out.indexOf(Math.max(...out));
    renderBars($("netOut"), OUT_NAMES.map((name, i) => ({ name, p: pulseT >= NET_SIZES.length - 1 ? out[i] : 0 })), pulseT >= NET_SIZES.length - 1 ? OUT_NAMES[best] : null);
  }

  function buildSliders() {
    const box = $("netSliders");
    IN_NAMES.forEach((name, i) => {
      const row = document.createElement("label");
      row.className = "slider-row";
      row.innerHTML = `<span>${name}</span><input type="range" min="0" max="1" step="0.01" value="${netInputs[i]}"><span>${netInputs[i].toFixed(2)}</span>`;
      const input = row.querySelector("input");
      input.addEventListener("input", () => {
        netInputs[i] = Number(input.value);
        row.lastElementChild.textContent = netInputs[i].toFixed(2);
        pulseT = NET_SIZES.length;
        drawNet();
      });
      box.appendChild(row);
    });
  }

  let pulseAnim = 0;
  function runPulse() {
    cancelAnimationFrame(pulseAnim);
    if (reduceMotion) { pulseT = NET_SIZES.length; drawNet(); return; }
    const start = performance.now();
    const dur = 2200;
    const tick = (now) => {
      pulseT = ((now - start) / dur) * (NET_SIZES.length - 1);
      drawNet();
      if (pulseT < NET_SIZES.length - 1) pulseAnim = requestAnimationFrame(tick);
      else { pulseT = NET_SIZES.length; drawNet(); }
    };
    pulseAnim = requestAnimationFrame(tick);
  }

  $("pulseBtn").addEventListener("click", runPulse);
  $("reweightBtn").addEventListener("click", () => {
    const btn = $("reweightBtn");
    if (btn.dataset.state === "random") {
      trainNet();
      btn.dataset.state = "";
      btn.textContent = "Shuffle weights";
    } else {
      initNet();
      btn.dataset.state = "random";
      btn.textContent = "Train it again";
    }
    runPulse();
  });
  initNet();
  trainNet();
  buildSliders();
  drawNet();
  redrawers.push(drawNet);
  window.addEventListener("resize", drawNet);

  /* ================= 5. Next-word prediction ================= */
  const CORPUS = `
    the cat sat on the mat . the cat was tired . the cat chased the mouse .
    the dog sat on the rug . the dog was happy . the dog chased the cat .
    the cat likes to sleep in the sun . the dog likes to play in the park .
    the sun is bright today . the sun is warm and the sky is blue .
    the ai reads a lot of text . the ai learns to predict the next word .
    the ai writes one word at a time . a model is trained on text .
    the model learns patterns from data . the model predicts the next word .
    the cat sat in the sun . the dog was tired after the walk .
    a cat is a small animal . a dog is a loyal friend .
    the mouse ran away from the cat . the park is full of happy dogs .
    i like the cat . i like the sun . i like to learn about ai .
  `.trim().split(/\s+/);

  const bi = new Map(), tri = new Map(), uni = new Map();
  const bump = (map, key, next) => {
    if (!map.has(key)) map.set(key, new Map());
    const m = map.get(key);
    m.set(next, (m.get(next) || 0) + 1);
  };
  CORPUS.forEach((w, i) => {
    uni.set(w, (uni.get(w) || 0) + 1);
    if (i > 0) bump(bi, CORPUS[i - 1], w);
    if (i > 1) bump(tri, CORPUS[i - 2] + " " + CORPUS[i - 1], w);
  });
  const toProbs = (m) => {
    let total = 0; m.forEach((c) => (total += c));
    const out = new Map(); m.forEach((c, k) => out.set(k, c / total));
    return out;
  };

  function nextDist(words) {
    const n = words.length;
    const p = new Map();
    const add = (dist, weight) => dist.forEach((v, k) => p.set(k, (p.get(k) || 0) + v * weight));
    const t = n >= 2 && tri.get(words[n - 2] + " " + words[n - 1]);
    const b = n >= 1 && bi.get(words[n - 1]);
    if (t && b) { add(toProbs(t), 0.75); add(toProbs(b), 0.25); }
    else if (b) add(toProbs(b), 1);
    else add(toProbs(uni), 1);
    return p;
  }

  const PROMPT = ["the", "cat"];
  let genWords = [...PROMPT];
  let lastPicked = null;
  let autoTimer = null;

  const temperature = () => Number($("temp").value);

  function tempered(dist) {
    const T = temperature();
    const entries = [...dist.entries()].map(([k, v]) => [k, Math.pow(v, 1 / T)]);
    const sum = entries.reduce((s, [, v]) => s + v, 0);
    return entries.map(([name, v]) => ({ name, p: v / sum })).sort((a, b) => b.p - a.p);
  }

  function renderGen() {
    const box = $("genText");
    box.innerHTML = "";
    genWords.forEach((w, i) => {
      const s = document.createElement("span");
      s.className = i < PROMPT.length ? "prompt" : "new";
      if (i >= PROMPT.length && i < genWords.length - 1) s.className = "";
      s.textContent = w;
      if (i > 0 && w !== ".") box.append(" ");
      box.appendChild(s);
    });
    const c = document.createElement("span");
    c.className = "cursor";
    box.appendChild(c);
    const items = tempered(nextDist(genWords)).slice(0, 8);
    renderBars($("probBars"), items, lastPicked);
  }

  function pickNext() {
    const items = tempered(nextDist(genWords));
    let r = Math.random(), choice = items[items.length - 1].name;
    for (const it of items) { r -= it.p; if (r <= 0) { choice = it.name; break; } }
    renderBars($("probBars"), items.slice(0, 8), choice);
    lastPicked = choice;
    setTimeout(() => {
      genWords.push(choice);
      if (genWords.length > 60) genWords = [...PROMPT];
      lastPicked = null;
      renderGen();
    }, reduceMotion ? 0 : 380);
  }

  function stopAuto() {
    clearInterval(autoTimer);
    autoTimer = null;
    $("autoBtn").textContent = "▶ Auto-write";
  }

  $("stepBtn").addEventListener("click", () => { stopAuto(); pickNext(); });
  $("autoBtn").addEventListener("click", () => {
    if (autoTimer) return stopAuto();
    $("autoBtn").textContent = "■ Stop";
    let count = 0;
    pickNext();
    autoTimer = setInterval(() => { if (++count >= 14) stopAuto(); else pickNext(); }, 900);
  });
  $("resetGenBtn").addEventListener("click", () => { stopAuto(); genWords = [...PROMPT]; lastPicked = null; renderGen(); });
  $("temp").addEventListener("input", () => {
    const T = temperature();
    $("tempVal").textContent = T.toFixed(1);
    $("tempDesc").textContent = T < 0.5 ? "focused & repetitive" : T <= 1.3 ? "balanced" : "wild & random";
    renderGen();
  });
  renderGen();

  /* ================= 6. Training / gradient descent ================= */
  const LW = { min: -4, max: 4 };
  const loss = (w) => 0.12 * (w - 0.8) ** 2 + 0.45 * Math.sin(2.2 * w) + 1;
  const grad = (w) => 0.24 * (w - 0.8) + 0.99 * Math.cos(2.2 * w);
  const LS = { w: 600, h: 340, pad: 34 };
  let ys = [];
  for (let w = LW.min; w <= LW.max; w += 0.02) ys.push(loss(w));
  const lMin = Math.min(...ys) - 0.1, lMax = Math.max(...ys) + 0.1;
  const lx = (w) => LS.pad + ((w - LW.min) / (LW.max - LW.min)) * (LS.w - LS.pad * 2);
  const ly = (v) => LS.h - LS.pad - ((v - lMin) / (lMax - lMin)) * (LS.h - LS.pad * 2);

  let wPos = -3.4, trail = [], history = [], steps = 0, trainTimer = null;

  function renderLoss() {
    const svg = $("lossSvg");
    svg.innerHTML = "";
    const accent = cssVar("--accent"), a2 = cssVar("--accent-2"), a3 = cssVar("--accent-3"), border = cssVar("--border");
    const defs = svgEl("defs", {}, svg);
    const grad1 = svgEl("linearGradient", { id: "lossFill", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    svgEl("stop", { offset: "0%", "stop-color": accent, "stop-opacity": 0.35 }, grad1);
    svgEl("stop", { offset: "100%", "stop-color": accent, "stop-opacity": 0 }, grad1);

    svgEl("line", { x1: LS.pad, y1: LS.h - LS.pad, x2: LS.w - LS.pad, y2: LS.h - LS.pad, stroke: border }, svg);
    let d = "";
    for (let w = LW.min; w <= LW.max + 1e-9; w += 0.02) d += (d ? " L " : "M ") + lx(w).toFixed(1) + " " + ly(loss(w)).toFixed(1);
    svgEl("path", { d: d + ` L ${lx(LW.max)} ${LS.h - LS.pad} L ${lx(LW.min)} ${LS.h - LS.pad} Z`, fill: "url(#lossFill)" }, svg);
    svgEl("path", { d, fill: "none", stroke: accent, "stroke-width": 3 }, svg);
    const t1 = svgEl("text", { x: LS.w / 2, y: LS.h - 8, "text-anchor": "middle" }, svg);
    t1.textContent = "a weight's value →";
    const t2 = svgEl("text", { x: 12, y: LS.h / 2, transform: `rotate(-90 12 ${LS.h / 2})`, "text-anchor": "middle" }, svg);
    t2.textContent = "loss (how wrong) →";

    trail.forEach((w, i) => {
      svgEl("circle", { cx: lx(w), cy: ly(loss(w)), r: 3, fill: a3, opacity: 0.15 + 0.6 * (i / trail.length) }, svg);
      if (i > 0) svgEl("line", { x1: lx(trail[i - 1]), y1: ly(loss(trail[i - 1])), x2: lx(w), y2: ly(loss(w)), stroke: a3, "stroke-opacity": 0.35, "stroke-dasharray": "3 3" }, svg);
    });

    const g = grad(wPos);
    const dx = 0.7;
    svgEl("line", {
      x1: lx(wPos - dx), y1: ly(loss(wPos) - g * dx), x2: lx(wPos + dx), y2: ly(loss(wPos) + g * dx),
      stroke: a2, "stroke-width": 2, "stroke-dasharray": "6 4",
    }, svg);
    svgEl("circle", { cx: lx(wPos), cy: ly(loss(wPos)) - 9, r: 9, fill: a3, stroke: cssVar("--text"), "stroke-width": 2 }, svg);
    const lbl = svgEl("text", { x: lx(wPos), y: ly(loss(wPos)) - 26, "text-anchor": "middle" }, svg);
    lbl.textContent = `slope ${g >= 0 ? "+" : ""}${g.toFixed(2)}`;

    $("epoch").textContent = steps;
    $("lossVal").textContent = loss(wPos).toFixed(3);

    const hs = $("lossHist");
    hs.innerHTML = "";
    svgEl("line", { x1: 0, y1: 100, x2: 300, y2: 100, stroke: border }, hs);
    const tt = svgEl("text", { x: 4, y: 12 }, hs);
    tt.textContent = "loss over training steps";
    if (history.length > 1) {
      const n = Math.max(history.length, 20);
      const hMax = Math.max(...history), hMin = Math.min(...history, lMin + 0.1);
      let p = "";
      history.forEach((v, i) => {
        const x = (i / (n - 1)) * 296 + 2;
        const y = 96 - ((v - hMin) / (hMax - hMin || 1)) * 76;
        p += (p ? " L " : "M ") + x.toFixed(1) + " " + y.toFixed(1);
      });
      svgEl("path", { d: p, fill: "none", stroke: a3, "stroke-width": 2.5 }, hs);
    }
  }

  function trainStep() {
    trail.push(wPos);
    if (trail.length > 40) trail.shift();
    wPos = clamp(wPos - Number($("lr").value) * grad(wPos), LW.min, LW.max);
    steps++;
    history.push(loss(wPos));
    renderLoss();
    return Math.abs(grad(wPos)) < 0.003;
  }

  function stopTrain() { clearInterval(trainTimer); trainTimer = null; $("trainBtn").textContent = "▶ Train"; }
  $("trainBtn").addEventListener("click", () => {
    if (trainTimer) return stopTrain();
    $("trainBtn").textContent = "■ Pause";
    trainTimer = setInterval(() => { if (trainStep() || steps > 400) stopTrain(); }, 140);
  });
  $("trainStepBtn").addEventListener("click", () => { stopTrain(); trainStep(); });
  $("trainResetBtn").addEventListener("click", () => {
    stopTrain();
    wPos = LW.min + 0.3 + Math.random() * (LW.max - LW.min - 0.6);
    trail = []; history = [loss(wPos)]; steps = 0;
    renderLoss();
  });
  $("lr").addEventListener("input", () => { $("lrVal").textContent = Number($("lr").value).toFixed(2); });
  history = [loss(wPos)];
  renderLoss();
  redrawers.push(renderLoss);

  /* ================= 0. Full end-to-end walkthrough ================= */
  (function walkthrough() {
    const D = 8;
    const HIDDEN = 16;
    const VOCAB = [...new Set(CORPUS)];

    function rng(seed) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const matrix = (rows, cols, seed, scale) => {
      const r = rng(seed);
      return Array.from({ length: rows }, () => Array.from({ length: cols }, () => (r() * 2 - 1) * scale));
    };
    const matVec = (M, v) => M.map((row) => row.reduce((s, w, k) => s + w * v[k], 0));
    const add = (a, b) => a.map((v, i) => v + b[i]);
    const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
    const layerNorm = (v) => {
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) || 1;
      return v.map((x) => (x - mean) / sd * 0.6);
    };

    const LAYERS = [1, 2].map((l) => ({
      Wq: matrix(D, D, 100 + l, 0.6), Wk: matrix(D, D, 200 + l, 0.6), Wv: matrix(D, D, 300 + l, 0.6),
      W1: matrix(HIDDEN, D, 400 + l, 0.7), W2: matrix(D, HIDDEN, 500 + l, 0.35),
    }));

    function tokenVec(tok) {
      const key = clean(tok) || tok.trim();
      const r = rng(hash(tok.toLowerCase()));
      const v = Array.from({ length: D }, () => +((r() * 2 - 1) * 0.9).toFixed(2));
      if (EMB[key]) { v[0] = EMB[key][0]; v[1] = EMB[key][1]; }
      return v;
    }
    const posVec = (p) => Array.from({ length: D }, (_, d) => {
      const f = p / Math.pow(100, (2 * Math.floor(d / 2)) / D);
      return +(0.5 * (d % 2 ? Math.cos(f) : Math.sin(f))).toFixed(2);
    });

    function runLayer(X, L) {
      const Q = X.map((x) => matVec(L.Wq, x));
      const K = X.map((x) => matVec(L.Wk, x));
      const V = X.map((x) => matVec(L.Wv, x));
      const A = Q.map((q, i) => softmax(K.slice(0, i + 1).map((k) => dot(q, k) / Math.sqrt(D))));
      const attnOut = A.map((row) => row.reduce((acc, w, j) => acc.map((s, d) => s + w * V[j][d]), new Array(D).fill(0)));
      const H = X.map((x, i) => layerNorm(add(x, attnOut[i])));
      const hidden = H.map((h) => matVec(L.W1, h).map((z) => Math.max(0, z)));
      const out = H.map((h, i) => layerNorm(add(h, matVec(L.W2, hidden[i]))));
      return { A, H, hidden, out };
    }

    // ---- state ----
    let text = $("wtInput").value;
    let stage = 0;
    let model = null;
    let picked = null;
    let playTimer = null;

    function compute() {
      const toks = tokenize(text).slice(0, 12);
      const ids = toks.map((t) => hash(t.toLowerCase()) % 100000);
      const tv = toks.map(tokenVec);
      const pv = toks.map((_, i) => posVec(i));
      const X0 = tv.map((v, i) => add(v, pv[i]));
      const l1 = runLayer(X0, LAYERS[0]);
      const l2 = runLayer(l1.out, LAYERS[1]);
      const final = l2.out[l2.out.length - 1] || new Array(D).fill(0);

      const words = (text.toLowerCase().match(/[a-z]+|\./g) || []);
      const dist = nextDist(words);
      const logits = VOCAB.map((w) => {
        const p = dist.get(w) || 0;
        const base = p > 0 ? Math.log(p) * 2 + 6 : -7 + (hash(w + words.join(" ")) % 100) / 60;
        return { name: w, v: +(base + 0.25 * dot(final, tokenVec(w))).toFixed(2) };
      });
      return { toks, ids, tv, pv, X0, l1, l2, final, logits };
    }

    function probs() {
      const T = Number($("wtTemp").value);
      const ps = softmax(model.logits.map((l) => l.v), T);
      return model.logits.map((l, i) => ({ name: l.name, p: ps[i], v: l.v })).sort((a, b) => b.p - a.p);
    }

    function samplePick() {
      const items = probs();
      let r = Math.random();
      for (const it of items) { r -= it.p; if (r <= 0) return it.name; }
      return items[0].name;
    }

    // ---- small render helpers ----
    const fmt = (v) => (v > -0.05 ? "" : "−") + Math.abs(v).toFixed(1);
    function cellColor(v) {
      const c = v >= 0 ? cssVar("--pos") : cssVar("--neg");
      return `color-mix(in srgb, ${c} ${Math.round(clamp(Math.abs(v), 0, 1) * 80)}%, transparent)`;
    }
    function vecRow(label, v, cls = "", delay = 0) {
      const row = document.createElement("div");
      row.className = "vrow " + cls;
      row.style.setProperty("--d", v.length);
      const lab = document.createElement("span");
      lab.className = "vlabel";
      lab.textContent = label;
      row.appendChild(lab);
      v.forEach((x, d) => {
        const c = document.createElement("span");
        c.className = "vcell";
        c.style.background = cellColor(x);
        c.style.animationDelay = delay + d * 20 + "ms";
        c.textContent = fmt(x);
        c.title = `dimension ${d}: ${x.toFixed(3)}`;
        row.appendChild(c);
      });
      return row;
    }
    function headRow(n = D, label = "") {
      const row = document.createElement("div");
      row.className = "vrow head";
      row.style.setProperty("--d", n);
      row.innerHTML = `<span class="vlabel">${label}</span>` + Array.from({ length: n }, (_, d) => `<span class="vcell">d${d}</span>`).join("");
      return row;
    }
    const grid = (...rows) => { const g = document.createElement("div"); g.className = "vgrid"; rows.forEach((r) => g.appendChild(r)); return g; };
    const el = (tag, cls, txt) => { const e = document.createElement(tag); e.className = cls; e.textContent = txt; return e; };
    function gapRow() {
      const row = document.createElement("div");
      row.className = "vrow gap";
      row.style.setProperty("--d", D);
      row.innerHTML = `<span class="vlabel">⋮</span>` + `<span class="vcell">⋮</span>`.repeat(D);
      return row;
    }
    const h4 = (t) => { const e = document.createElement("h4"); e.textContent = t; return e; };
    const explain = (html) => { const e = document.createElement("p"); e.className = "explain"; e.innerHTML = html; return e; };
    const show = (t) => t.replace(/^ /, "·");
    const lastTok = () => show(model.toks[model.toks.length - 1] || "");

    function valueBars(container, items) {
      container.innerHTML = "";
      const max = Math.max(...items.map((i) => i.v)), min = Math.min(...items.map((i) => i.v), 0);
      items.forEach(({ name, v }) => {
        const row = document.createElement("div");
        row.className = "bar";
        row.innerHTML = `<span class="name"></span><span class="track"><span class="fill" style="width:0"></span></span><span class="pct">${v.toFixed(2)}</span>`;
        row.querySelector(".name").textContent = name;
        container.appendChild(row);
        requestAnimationFrame(() => { row.querySelector(".fill").style.width = (((v - min) / (max - min || 1)) * 100).toFixed(1) + "%"; });
      });
    }

    // ---- stages ----
    const STAGES = [
      {
        icon: "✂", short: "Tokens", title: "Split the text into tokens",
        desc: "The model can't read letters. A tokenizer chops the text into known pieces — words, parts of words and punctuation. (· marks a leading space.)",
        render(body) {
          const box = document.createElement("div");
          box.className = "chips";
          model.toks.forEach((t, i) => {
            const chip = document.createElement("span");
            chip.className = "chip";
            chip.style.setProperty("--h", (hash(t) % 360).toString());
            chip.style.animationDelay = i * 70 + "ms";
            chip.innerHTML = `<span class="t"></span><span class="id">#${i}</span>`;
            chip.querySelector(".t").textContent = show(t);
            box.appendChild(chip);
          });
          body.append(box, explain(`"${text}" → <b>${model.toks.length} tokens</b>. Each one is processed in parallel from here on.`));
        },
      },
      {
        icon: "#", short: "IDs", title: "From characters to numbers: the token ID",
        desc: "Inside a computer every character is already a number (its Unicode code, e.g. \"a\" = 97). But the model doesn't use letters one by one: the tokenizer matches whole pieces against a fixed dictionary called the vocabulary, and each piece's row number in that dictionary is its token ID.",
        render(body) {
          const chars = document.createElement("div");
          chars.className = "charflow";
          model.toks.forEach((t, i) => {
            const card = document.createElement("div");
            card.className = "charcard";
            card.style.animationDelay = i * 90 + "ms";
            const row = document.createElement("div");
            row.className = "charrow";
            [...t].forEach((ch) => {
              const c = document.createElement("span");
              c.className = "char";
              c.innerHTML = `<b></b><small>${ch.codePointAt(0)}</small>`;
              c.firstChild.textContent = ch === " " ? "␣" : ch;
              row.appendChild(c);
            });
            const arrow = document.createElement("div");
            arrow.className = "down";
            arrow.textContent = "↓ look up in vocabulary";
            const id = document.createElement("div");
            id.className = "idpair";
            id.innerHTML = `<span></span><span class="arrow">=</span><span class="num">ID ${model.ids[i]}</span>`;
            id.firstChild.textContent = show(t);
            card.append(row, arrow, id);
            chars.appendChild(card);
          });

          const ids = [...new Map(model.toks.map((t, i) => [model.ids[i], t])).entries()].sort((a, b) => a[0] - b[0]);
          const table = document.createElement("table");
          table.className = "vocab-table";
          table.innerHTML = "<thead><tr><th>ID (row number)</th><th>token piece</th></tr></thead>";
          const tb = document.createElement("tbody");
          const addRow = (id, tok, cls = "") => {
            const tr = document.createElement("tr");
            tr.className = cls;
            tr.innerHTML = `<td>${id}</td><td></td>`;
            tr.lastChild.textContent = tok;
            tb.appendChild(tr);
          };
          addRow(0, "!", "faded"); addRow(1, "\"", "faded"); addRow(2, "#", "faded");
          ids.forEach(([id, t]) => { addRow("⋮", "⋮", "gap"); addRow(id, show(t), "hit"); });
          addRow("⋮", "⋮", "gap"); addRow(99999, "·zebra", "faded");
          table.appendChild(tb);

          const wrap = document.createElement("div");
          wrap.className = "two-col";
          const a = document.createElement("div"), b = document.createElement("div");
          a.append(h4("Characters (with their Unicode numbers) → token ID"), chars);
          b.append(h4("The vocabulary: a fixed list of 100,000 pieces"), table);
          wrap.append(a, b);
          body.append(wrap, explain(`So the text <code>"${text}"</code> becomes just the list <code>[${model.ids.join(", ")}]</code>. The character codes are only used to find the piece; from here on the model only sees the IDs. The vocabulary is built once, before training, from the most common character sequences in a lot of text.`));
        },
      },
      {
        icon: "▦", short: "Vectors", title: "The ID picks a row from the embedding table: that row is the vector",
        desc: "The model has a big table of numbers called the embedding table: one row per vocabulary ID, one column per dimension. The token ID just says which row to read. That row of numbers is the token's vector. The numbers start random and are adjusted during training until similar words have similar rows.",
        render(body) {
          const ids = [...new Map(model.toks.map((t, i) => [model.ids[i], i])).entries()].sort((a, b) => a[0] - b[0]);
          const filler = (seed) => { const r = rng(seed); return Array.from({ length: D }, () => +((r() * 2 - 1) * 0.9).toFixed(2)); };
          const tableRows = [headRow(D, "row (ID)")];
          tableRows.push(vecRow("0  !", filler(1), "faded"));
          tableRows.push(vecRow("1  \"", filler(2), "faded"));
          ids.forEach(([id, i], k) => {
            tableRows.push(gapRow());
            tableRows.push(vecRow(`${id} ${show(model.toks[i])}`, model.tv[i], "hit", k * 160));
          });
          tableRows.push(gapRow());
          tableRows.push(vecRow("99999 ·zebra", filler(3), "faded"));
          const tbl = grid(...tableRows);
          tbl.classList.add("wide-label");

          const out = grid(headRow(D, "token"), ...model.toks.map((t, i) => vecRow(`${show(t)} (${model.ids[i]})`, model.tv[i], "", 400 + i * 80)));
          out.classList.add("wide-label");

          body.append(
            h4(`Embedding table: 100,000 rows × ${D} columns (highlighted = rows used by your prompt)`), tbl,
            el("div", "flow-arrow big", "↓ copy each token's row, in sentence order ↓"),
            h4("Result: one vector per token, the input to the rest of the model"), out,
            explain(`<span class="sw pos"></span>positive <span class="sw neg"></span>negative. In this demo, d0 and d1 hold the word's position on the 2D meaning map further down the page. Real tables are much bigger: GPT-3's is 50,257 rows × 12,288 columns, about 600 million learned numbers just for this one lookup.`),
          );
        },
      },
      {
        icon: "⌖", short: "Position", title: "Add position information",
        desc: "Attention on its own doesn't know word order (\"dog bites man\" vs \"man bites dog\"). So a position signal — a wave pattern unique to each slot — is added to each vector.",
        render(body) {
          const wrap = document.createElement("div");
          wrap.className = "two-col";
          const a = document.createElement("div"), b = document.createElement("div");
          a.append(h4("Position signal"), grid(headRow(), ...model.pv.map((v, i) => vecRow("pos " + i, v, "", i * 50))));
          b.append(h4("Embedding + position = input"), grid(headRow(), ...model.X0.map((v, i) => vecRow(show(model.toks[i]), v, "sum", i * 50))));
          wrap.append(a, b);
          body.append(wrap);
        },
      },
      {
        icon: "⇄", short: "Attention", title: "Attention: tokens share information",
        desc: "Each token makes a Query (\"what am I looking for?\"), a Key (\"what do I contain?\") and a Value (\"what I'll share\"). Query·Key scores → softmax → weights. Each token then takes a weighted mix of the earlier tokens' Values.",
        render(body) {
          const A = model.l1.A, n = A.length;
          const m = document.createElement("div");
          m.className = "matrix";
          m.style.gridTemplateColumns = `80px repeat(${n}, minmax(26px, 46px))`;
          m.appendChild(document.createElement("div")).className = "lab";
          model.toks.forEach((t) => { const d = document.createElement("div"); d.className = "lab collab"; d.textContent = show(t); m.appendChild(d); });
          A.forEach((row, i) => {
            const lab = document.createElement("div");
            lab.className = "lab rowlab";
            lab.textContent = show(model.toks[i]);
            m.appendChild(lab);
            for (let j = 0; j < n; j++) {
              const c = document.createElement("div");
              if (j <= i) {
                c.style.background = `color-mix(in srgb, ${cssVar("--accent-2")} ${Math.round(row[j] * 100)}%, transparent)`;
                c.style.outline = `1px solid ${cssVar("--border")}`;
                c.textContent = Math.round(row[j] * 100);
                c.title = `${model.toks[i]} → ${model.toks[j]}: ${(row[j] * 100).toFixed(1)}%`;
              }
              m.appendChild(c);
            }
          });
          const last = A[n - 1].map((w, j) => ({ name: show(model.toks[j]), p: w })).sort((a, b) => b.p - a.p).slice(0, 5);
          const wrap = document.createElement("div");
          wrap.className = "two-col";
          const a = document.createElement("div"), b = document.createElement("div");
          a.append(h4("Attention weights, layer 1 (%)"), m);
          const bars = document.createElement("div");
          bars.className = "bars";
          b.append(h4(`What "${lastTok()}" mixes in`), bars);
          b.append(explain("Blank upper triangle = tokens can't look at future words. Real models run 32–128 attention heads at once, each finding different patterns."));
          wrap.append(a, b);
          body.append(wrap);
          renderBars(bars, last);
        },
      },
      {
        icon: "◉", short: "Layers", title: "Feed-forward network, then repeat for every layer",
        desc: "After attention, each token's vector goes through a small neural network: it expands to many neurons, applies ReLU (negative → 0), and shrinks back. Attention + feed-forward = one layer. Here we stack 2; GPT-class models stack 30–120.",
        render(body) {
          const i = model.toks.length - 1;
          const hid = model.l1.hidden[i];
          const maxH = Math.max(...hid, 0.01);
          const neurons = document.createElement("div");
          neurons.className = "neurons";
          hid.forEach((h, k) => {
            const d = document.createElement("div");
            d.style.background = `color-mix(in srgb, ${cssVar("--accent")} ${Math.round((h / maxH) * 100)}%, transparent)`;
            d.style.animationDelay = k * 30 + "ms";
            d.title = `neuron ${k}: ${h.toFixed(2)}`;
            neurons.appendChild(d);
          });
          const on = hid.filter((h) => h > 0).length;
          body.append(
            h4(`Inside layer 1 — the ${HIDDEN} hidden neurons for "${lastTok()}" (${on} fired, ${HIDDEN - on} silent)`), neurons,
            h4(`How "${lastTok()}"'s vector changes as it goes through the layers`),
            grid(
              headRow(),
              vecRow("input", model.X0[i], "", 0),
              vecRow("layer 1", model.l1.out[i], "", 150),
              vecRow("layer 2", model.l2.out[i], "sum", 300),
            ),
            explain(`By the last layer, the vector for the final token "${lastTok()}" holds what the model has worked out about the <b>whole</b> sentence, ready to predict what comes next.`),
          );
        },
      },
      {
        icon: "≡", short: "Scores", title: "Score every word in the vocabulary (logits)",
        desc: "The final vector of the last token is compared with every word in the vocabulary, giving each one a raw score called a logit. Higher = more likely to come next.",
        render(body) {
          const sorted = [...model.logits].sort((a, b) => b.v - a.v);
          const bars = document.createElement("div");
          bars.className = "bars";
          const strip = document.createElement("div");
          strip.className = "vocab-strip";
          const max = sorted[0].v, min = sorted[sorted.length - 1].v;
          model.logits.forEach((l) => {
            const d = document.createElement("div");
            d.style.background = `color-mix(in srgb, ${cssVar("--accent")} ${Math.round(((l.v - min) / (max - min || 1)) * 100)}%, ${cssVar("--bg-2")})`;
            d.title = `${l.name}: ${l.v}`;
            strip.appendChild(d);
          });
          body.append(grid(vecRow(`final "${lastTok()}"`, model.final, "sum")), h4("Top 10 raw scores"), bars,
            h4(`All ${VOCAB.length} words in this tiny vocabulary (hover one)`), strip,
            explain(`Real models score ~100,000 tokens this way, every single time they write a token.`));
          valueBars(bars, sorted.slice(0, 10));
        },
      },
      {
        icon: "%", short: "Probability", title: "Softmax: turn scores into probabilities",
        desc: "Softmax turns the scores into percentages that add up to 100%. Temperature controls how sharp that is: low = the top word dominates, high = more evenly spread.",
        render(body) {
          const items = probs();
          const bars = document.createElement("div");
          bars.className = "bars";
          const top = items.slice(0, 8);
          const rest = items.slice(8).reduce((s, i) => s + i.p, 0);
          body.append(h4(`P(next word | "${text}")`), bars,
            explain(`Formula: <code>p = e^(score / T) / Σ e^(score / T)</code>. Top 8 shown; the other ${items.length - 8} words share ${(rest * 100).toFixed(1)}%. Try the temperature slider above.`));
          renderBars(bars, top);
        },
      },
      {
        icon: "🎲", short: "Pick", title: "Pick one token and add it to the text",
        desc: "One word is randomly drawn using those probabilities (like a weighted dice roll). It's added to the text, and the WHOLE process runs again from step 1 for the next token.",
        render(body) {
          if (!picked) picked = samplePick();
          const items = probs();
          const wordBox = document.createElement("div");
          const pw = document.createElement("span");
          pw.className = "picked-word rolling";
          wordBox.append(pw);
          const res = document.createElement("div");
          res.className = "result-text";
          const bars = document.createElement("div");
          bars.className = "bars";
          body.append(h4("Rolling the weighted dice…"), wordBox, res, h4("Chosen from"), bars);
          renderBars(bars, items.slice(0, 8), picked);
          const finish = () => {
            pw.className = "picked-word";
            pw.textContent = picked;
            const p = items.find((x) => x.name === picked);
            res.innerHTML = "";
            res.append(text + (picked === "." ? "" : " "));
            const s = document.createElement("span");
            s.className = "new";
            s.textContent = picked;
            res.append(s);
            body.append(explain(`Picked "<b>${picked}</b>" (it had a ${(p.p * 100).toFixed(1)}% chance). Press <b>⟳ Add word &amp; run again</b> to feed it back in, which is how a chatbot writes a whole answer.`));
          };
          if (reduceMotion) return finish();
          let n = 0;
          const roll = setInterval(() => {
            pw.textContent = items[Math.floor(Math.random() * Math.min(8, items.length))].name;
            if (++n > 12) { clearInterval(roll); finish(); }
          }, 70);
        },
      },
    ];

    const stepper = $("wtStepper");
    STAGES.forEach((s, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.innerHTML = `<b>${s.icon}</b>${i + 1}. ${s.short}`;
      b.addEventListener("click", () => { stopPlay(); go(i); });
      li.appendChild(b);
      stepper.appendChild(li);
    });

    function go(i) {
      stage = clamp(i, 0, STAGES.length - 1);
      const s = STAGES[stage];
      $("wtBadge").textContent = `Step ${stage + 1} / ${STAGES.length}`;
      $("wtTitle").textContent = s.title;
      $("wtDesc").textContent = s.desc;
      const body = $("wtBody");
      const fresh = body.cloneNode(false);
      body.replaceWith(fresh);
      s.render(fresh);
      [...stepper.querySelectorAll("button")].forEach((b, k) => {
        b.classList.toggle("on", k === stage);
        b.classList.toggle("done", k < stage);
      });
      $("wtPrev").disabled = stage === 0;
      $("wtNext").disabled = stage === STAGES.length - 1;
    }

    function recompute(keepStage) {
      text = $("wtInput").value.trim() || "the cat";
      model = compute();
      picked = null;
      go(keepStage ? stage : 0);
    }

    function stopPlay() {
      clearInterval(playTimer);
      playTimer = null;
      $("wtPlay").textContent = "▶ Play all steps";
    }
    function play() {
      if (playTimer) return stopPlay();
      $("wtPlay").textContent = "■ Stop";
      if (stage === STAGES.length - 1) go(0);
      playTimer = setInterval(() => {
        if (stage >= STAGES.length - 1) return stopPlay();
        go(stage + 1);
      }, 2600);
    }

    $("wtNext").addEventListener("click", () => { stopPlay(); go(stage + 1); });
    $("wtPrev").addEventListener("click", () => { stopPlay(); go(stage - 1); });
    $("wtPlay").addEventListener("click", play);
    $("wtLoop").addEventListener("click", () => {
      stopPlay();
      if (!picked) picked = samplePick();
      $("wtInput").value = text + (picked === "." ? "." : " " + picked);
      recompute(false);
      play();
    });
    $("wtReset").addEventListener("click", () => { stopPlay(); $("wtInput").value = "the cat sat on the"; recompute(false); });
    let inputTimer;
    $("wtInput").addEventListener("input", () => { clearTimeout(inputTimer); inputTimer = setTimeout(() => recompute(true), 250); });
    $("wtTemp").addEventListener("input", () => {
      $("wtTempVal").textContent = Number($("wtTemp").value).toFixed(1);
      picked = null;
      if (stage >= 7) go(stage);
    });
    redrawers.push(() => go(stage));
    recompute(false);
  })();
})();
