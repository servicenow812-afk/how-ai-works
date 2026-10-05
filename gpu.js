/* How AI Works: why AI needs GPUs. Uses helpers exposed by app.js. */
(() => {
  "use strict";

  const { cssVar, renderBars, clamp, reduceMotion, redrawers } = window.HAI;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // Hardware assumptions (stated on the page).
  const H100 = { mem: 80e9, bw: 3.35e12, flops: 989e12, watts: 700 };
  const LAPTOP = { bw: 80e9, ram: 16e9 };
  const TRAIN_UTIL = 0.4;
  const BYTES = 2;
  const HOME_KWH_YEAR = 10800;

  // Architectures (weights per layer counted from the published configs).
  const MODELS = [
    { name: "GPT-2 small", year: 2019, d: 768, L: 12, vocab: 50257, attn: 4 * 768 * 768, ffn: 2 * 768 * 3072, kv: 2 * 12 * 768, tied: true, tokens: 1e10, tokNote: "estimate (not published)" },
    { name: "Llama 3 8B", year: 2024, d: 4096, L: 32, vocab: 128256, attn: 2 * 4096 * 4096 + 2 * 4096 * 1024, ffn: 3 * 4096 * 14336, kv: 2 * 32 * 1024, tied: false, tokens: 15e12, tokNote: "published: 15T+" },
    { name: "GPT-3", year: 2020, d: 12288, L: 96, vocab: 50257, attn: 4 * 12288 * 12288, ffn: 8 * 12288 * 12288, kv: 2 * 96 * 12288, tied: true, tokens: 3e11, tokNote: "published: 300B" },
    { name: "Llama 3 405B", year: 2024, d: 16384, L: 126, vocab: 128256, attn: 2 * 16384 * 16384 + 2 * 16384 * 1024, ffn: 3 * 16384 * 53248, kv: 2 * 126 * 1024, tied: false, tokens: 15.6e12, tokNote: "published: 15.6T" },
  ];
  MODELS.forEach((m) => { m.params = m.L * (m.attn + m.ffn) + m.vocab * m.d * (m.tied ? 1 : 2); });

  const CTX = [0, 100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000];
  const USERS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 5000];
  $("ctx").max = CTX.length - 1;
  $("ctx").value = 4;
  $("users").max = USERS.length - 1;

  let model = MODELS[1];
  let benchGflops = null;

  /* ---------- formatting ---------- */
  function big(n) {
    const units = [[1e24, "septillion"], [1e21, "sextillion"], [1e18, "quintillion"], [1e15, "quadrillion"], [1e12, "trillion"], [1e9, "billion"], [1e6, "million"], [1e3, "thousand"]];
    for (const [v, w] of units) if (n >= v) return `${(n / v).toFixed(n / v < 10 ? 1 : 0)} ${w}`;
    return Math.round(n).toString();
  }
  function bytes(n) {
    const u = [[1e12, "TB"], [1e9, "GB"], [1e6, "MB"], [1e3, "KB"]];
    for (const [v, w] of u) if (n >= v) return `${(n / v).toFixed(n / v < 10 ? 1 : 0)} ${w}`;
    return `${Math.round(n)} B`;
  }
  function dur(s) {
    if (s < 1e-3) return `${(s * 1e6).toFixed(0)} µs`;
    if (s < 1) return `${(s * 1e3).toFixed(s < 0.01 ? 1 : 0)} ms`;
    if (s < 120) return `${s.toFixed(1)} seconds`;
    if (s < 7200) return `${(s / 60).toFixed(0)} minutes`;
    if (s < 2 * 86400) return `${(s / 3600).toFixed(1)} hours`;
    if (s < 2 * 365 * 86400) return `${(s / 86400).toFixed(0)} days`;
    return `${big(s / (365 * 86400))} years`;
  }

  /* ---------- model picker ---------- */
  function renderPicker() {
    const seg = $("gpuModelSeg");
    seg.innerHTML = "";
    MODELS.forEach((m) => {
      const b = el("button", m === model ? "on" : "", `${m.name} (${m.year})`);
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", m === model);
      b.addEventListener("click", () => {
        model = m;
        $("trainTok").value = Math.log10(m.tokens);
        renderAllCards();
      });
      seg.appendChild(b);
    });
    const f = $("gpuModelFacts");
    f.innerHTML = "";
    [
      [big(model.params), "learned numbers (weights)"],
      [String(model.L), "layers, each one run for every token"],
      [model.d.toLocaleString(), "numbers per token vector"],
      [bytes(model.params * BYTES), "of weights at 2 bytes each"],
    ].forEach(([v, t]) => {
      const d = el("div");
      d.append(el("b", "", v), el("span", "", t));
      f.appendChild(d);
    });
  }

  /* ---------- ① FLOPs per token ---------- */
  function tokenFlops(ctx) {
    const m = model;
    const parts = [
      { name: "Feed-forward layers", v: 2 * m.L * m.ffn },
      { name: "Attention weights (Q, K, V, output)", v: 2 * m.L * m.attn },
      { name: "Attention over the conversation", v: 4 * ctx * m.d * m.L },
      { name: "Output layer (score every token)", v: 2 * m.vocab * m.d },
      { name: "Embedding lookup", v: 0 },
    ];
    return { parts, total: parts.reduce((s, p) => s + p.v, 0) };
  }
  function renderFlops() {
    const ctx = CTX[Number($("ctx").value)];
    $("ctxVal").textContent = ctx.toLocaleString();
    const { parts, total } = tokenFlops(ctx);
    $("flopsBig").innerHTML = `<b>${big(total)}</b> operations to produce <u>one</u> token <span class="muted">(${(total / 1e9).toFixed(1)} GFLOP)</span>`;
    renderBars($("flopsBars"), parts.map((p) => ({ name: p.name, p: p.v / total })));
    $("flopsBars").querySelectorAll(".bar").forEach((r, i) => { r.querySelector(".pct").textContent = parts[i].v ? (parts[i].v / 1e9).toFixed(2) + " G" : "≈ 0"; });
    const answer = 500 * total;
    const humanYears = total / (365 * 86400);
    $("flopsExplain").innerHTML =
      `Each weight is used in one multiply and one add for every token, so the total is ≈ 2 × ${big(model.params)} weights. ` +
      `A 500-token answer = <b>${big(answer)}</b> operations. If a person did one calculation per second without sleeping, one token alone would take them <b>${big(humanYears)} years</b>. ` +
      `Note how "attention over the conversation" grows as the chat gets longer.`;
  }

  /* ---------- ② benchmark ---------- */
  function runBench() {
    const N = 256;
    const A = new Float32Array(N * N), B = new Float32Array(N * N), C = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) { A[i] = Math.random(); B[i] = Math.random(); }
    let best = Infinity;
    for (let rep = 0; rep < 4; rep++) {
      C.fill(0);
      const t0 = performance.now();
      for (let i = 0; i < N; i++) {
        const io = i * N;
        for (let k = 0; k < N; k++) {
          const a = A[io + k], ko = k * N;
          for (let j = 0; j < N; j++) C[io + j] += a * B[ko + j];
        }
      }
      best = Math.min(best, performance.now() - t0);
    }
    benchGflops = (2 * N * N * N) / (best / 1000) / 1e9;
    renderBench(best);
  }
  function renderBench(ms) {
    const out = $("benchOut");
    out.innerHTML = "";
    if (benchGflops === null) return;
    const perTok = tokenFlops(CTX[Number($("ctx").value)]).total;
    const tDevice = perTok / (benchGflops * 1e9);
    const tGpu = perTok / H100.flops;
    const s = el("div", "stats facts");
    [
      [`${benchGflops.toFixed(2)} GFLOPS`, `your device in this browser tab${ms ? ` (${ms.toFixed(0)} ms for 33.5M operations)` : ""}`],
      [dur(tDevice), `for ONE ${model.name} token on your device at that speed`],
      [dur(500 * tDevice), "for a 500-token answer on your device"],
      [dur(500 * tGpu), "for the same answer's maths on one H100 (if compute were the only limit)"],
    ].forEach(([v, t]) => { const d = el("div"); d.append(el("b", "", v), el("span", "", t)); s.appendChild(d); });
    out.appendChild(s);
    out.appendChild(el("p", "note", `An H100 is about ${big(H100.flops / (benchGflops * 1e9))} times faster than this test. (Browser JavaScript uses a single CPU core, so a native CPU program would be roughly 10–100× faster, which is still far slower than a GPU.)`));
  }

  /* ---------- ③ CPU vs GPU race ---------- */
  const canvas = $("raceCanvas");
  const ctx2 = canvas.getContext("2d");
  const GRID = 24, CELLS = GRID * GRID, CPU_CORES = 8, CPU_T = 1, GPU_T = 4, UNIT = 55;
  let raceT = 0, raceAnim = 0;
  function drawRace() {
    const Wc = canvas.clientWidth || 640;
    const Hc = Wc * (330 / 640);
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(Wc * dpr)) { canvas.width = Math.round(Wc * dpr); canvas.height = Math.round(Hc * dpr); }
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, Wc, Hc);
    const panelW = (Wc - 30) / 2, cell = Math.min((panelW - 4) / GRID, (Hc - 70) / GRID);
    const cpuDone = Math.min(CELLS, Math.floor(raceT / CPU_T) * CPU_CORES);
    const cpuActive = cpuDone < CELLS ? Math.min(CPU_CORES, CELLS - cpuDone) : 0;
    const cpuFrac = (raceT % CPU_T) / CPU_T;
    const gpuDone = raceT >= GPU_T ? CELLS : 0;
    const gpuFrac = Math.min(raceT / GPU_T, 1);
    const panels = [
      { x: 10, label: `CPU · ${CPU_CORES} cores`, done: cpuDone, active: cpuActive, frac: cpuFrac, time: Math.min(raceT, (CELLS / CPU_CORES) * CPU_T), color: cssVar("--accent-3") },
      { x: 20 + panelW, label: `GPU · ${CELLS} cores at once`, done: gpuDone, active: gpuDone ? 0 : CELLS, frac: gpuFrac, time: Math.min(raceT, GPU_T), color: cssVar("--accent-2") },
    ];
    ctx2.font = "600 13px Inter, sans-serif";
    ctx2.textBaseline = "top";
    for (const p of panels) {
      ctx2.fillStyle = cssVar("--text");
      ctx2.fillText(p.label, p.x, 4);
      for (let i = 0; i < CELLS; i++) {
        const cx = p.x + (i % GRID) * cell, cy = 26 + Math.floor(i / GRID) * cell;
        let a = 0.08;
        if (i < p.done) a = 1;
        else if (i < p.done + p.active && raceT > 0) a = 0.15 + 0.6 * p.frac;
        ctx2.globalAlpha = a;
        ctx2.fillStyle = a > 0.08 ? p.color : cssVar("--muted");
        ctx2.fillRect(cx + 0.5, cy + 0.5, cell - 1, cell - 1);
      }
      ctx2.globalAlpha = 1;
      ctx2.fillStyle = cssVar("--muted");
      ctx2.font = "500 12px Inter, sans-serif";
      ctx2.fillText(`${Math.min(p.done, CELLS)} / ${CELLS} done · ${p.time.toFixed(0)} time units`, p.x, 30 + GRID * cell);
      ctx2.font = "600 13px Inter, sans-serif";
    }
  }
  function race() {
    cancelAnimationFrame(raceAnim);
    const end = (CELLS / CPU_CORES) * CPU_T;
    if (reduceMotion) { raceT = end; drawRace(); return; }
    const t0 = performance.now();
    const tick = (now) => {
      raceT = (now - t0) / UNIT;
      if (raceT >= end) { raceT = end; drawRace(); return; }
      drawRace();
      raceAnim = requestAnimationFrame(tick);
    };
    raceAnim = requestAnimationFrame(tick);
  }

  /* ---------- ④ memory ---------- */
  function renderMemory() {
    const ctx = CTX[Number($("ctx").value)] || 1;
    const users = USERS[Number($("users").value)];
    $("usersVal").textContent = users.toLocaleString();
    const wBytes = model.params * BYTES;
    const kvTok = model.kv * BYTES;
    const kvBytes = kvTok * ctx * users;
    const total = wBytes + kvBytes;
    const gpus = Math.ceil(total / H100.mem);

    const box = $("memViz");
    box.innerHTML = "";
    const row = el("div", "mem-row");
    const shown = Math.min(gpus, 24);
    for (let g = 0; g < shown; g++) {
      const card = el("div", "gpu-card");
      const start = g * H100.mem;
      const wPart = clamp(wBytes - start, 0, H100.mem);
      const kvPart = clamp(total - start - wPart, 0, H100.mem - wPart);
      const fw = el("div", "gpu-fill w");
      fw.style.height = (wPart / H100.mem) * 100 + "%";
      const fk = el("div", "gpu-fill kv");
      fk.style.height = (kvPart / H100.mem) * 100 + "%";
      card.append(fk, fw, el("span", "gpu-label", "80 GB"));
      row.appendChild(card);
    }
    if (gpus > shown) row.appendChild(el("div", "gpu-more", `+ ${(gpus - shown).toLocaleString()} more`));
    const legend = el("div", "legend");
    legend.innerHTML = `<span><i style="background:${cssVar("--accent")}"></i>weights ${bytes(wBytes)}</span><span><i style="background:${cssVar("--accent-3")}"></i>KV cache (conversation memory) ${bytes(kvBytes)}</span>`;
    box.append(el("div", "big-number", ""), row, legend);
    box.firstChild.innerHTML = `<b>${gpus.toLocaleString()}</b> H100 GPU${gpus > 1 ? "s" : ""} needed just to <u>hold</u> it all <span class="muted">(${bytes(total)})</span>`;

    const tGpu = wBytes / (H100.bw * gpus);
    const tLaptop = wBytes / LAPTOP.bw;
    $("memExplain").innerHTML =
      `To write each token, every weight (${bytes(wBytes)}) must be read from memory once. ` +
      `At H100 memory speed (3.35 TB/s per GPU) that takes ≈ <b>${dur(tGpu)}</b> per token; from typical laptop RAM (~80 GB/s) ≈ <b>${dur(tLaptop)}</b> per token` +
      (wBytes > LAPTOP.ram ? `, and it wouldn't even fit in a 16 GB laptop` : "") + `. ` +
      `Each token of conversation also stores ${bytes(kvTok)} of attention keys and values (the KV cache) so later tokens can look back at it. ` +
      `${ctx.toLocaleString()} tokens × ${users.toLocaleString()} chat${users > 1 ? "s" : ""} = ${bytes(kvBytes)}.`;
  }

  /* ---------- ⑤ training ---------- */
  function renderTraining() {
    const tokens = Math.pow(10, Number($("trainTok").value));
    const nGpu = Math.pow(2, Number($("gpus").value));
    $("trainTokVal").textContent = `${big(tokens)}` + (Math.abs(Math.log10(tokens) - Math.log10(model.tokens)) < 0.03 ? ` (${model.tokNote})` : "");
    $("gpusVal").textContent = nGpu.toLocaleString();
    const flops = 6 * model.params * tokens;
    const secs = flops / (nGpu * H100.flops * TRAIN_UTIL);
    const memNeed = 16 * model.params;
    const minGpus = Math.ceil(memNeed / H100.mem);
    const kwh = (nGpu * H100.watts * secs) / 3.6e6;
    const s = $("trainStats");
    s.innerHTML = "";
    [
      [big(flops), "operations in total (≈ 6 × weights × tokens)"],
      [dur(secs), `on ${nGpu.toLocaleString()} H100${nGpu > 1 ? "s" : ""} at 40% efficiency`],
      [bytes(memNeed), `memory for weights + gradients + optimizer state, so at least ${minGpus.toLocaleString()} GPU${minGpus > 1 ? "s" : ""}`],
      [`${big(kwh)} kWh`, `GPU electricity alone ≈ ${big(kwh / HOME_KWH_YEAR)} years of an average US home's use`],
    ].forEach(([v, t]) => { const d = el("div"); d.append(el("b", "", v), el("span", "", t)); s.appendChild(d); });
    $("trainExplain").innerHTML =
      `Why 6×? For each training token the model does the forward pass (2 operations per weight, like above), then backpropagation works out a gradient for every weight (≈ 4 more). ` +
      `Training also needs ~16 bytes per weight (16-bit weights and gradients, plus a 32-bit master copy and two Adam optimizer numbers), compared with 2 bytes to just use the model. ` +
      (nGpu < minGpus ? `<b>With only ${nGpu.toLocaleString()} GPU${nGpu > 1 ? "s" : ""}, this model doesn't even fit in memory for training.</b>` : `Real runs: GPT-3 used about 3.1 × 10²³ operations; Llama 3 405B used about 3.8 × 10²⁵ on up to 16,384 H100s.`);
  }

  function renderAllCards() {
    renderPicker();
    renderFlops();
    renderBench();
    renderMemory();
    renderTraining();
  }

  $("ctx").addEventListener("input", () => { renderFlops(); renderBench(); renderMemory(); });
  $("users").addEventListener("input", renderMemory);
  $("trainTok").addEventListener("input", renderTraining);
  $("gpus").addEventListener("input", renderTraining);
  $("benchBtn").addEventListener("click", () => {
    $("benchBtn").textContent = "Measuring…";
    setTimeout(() => { runBench(); $("benchBtn").textContent = "⏱ Measure again"; }, 30);
  });
  $("raceBtn").addEventListener("click", race);
  window.addEventListener("resize", drawRace);
  redrawers.push(() => { renderAllCards(); drawRace(); });

  $("trainTok").value = Math.log10(model.tokens);
  renderAllCards();
  drawRace();
})();
