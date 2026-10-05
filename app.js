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
})();
