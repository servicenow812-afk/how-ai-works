/* How AI Works: behind the scenes (dataset, live training, storage). Uses helpers exposed by app.js. */
(() => {
  "use strict";

  const H = window.HAI;
  const { CORPUS, softmax, hash, cssVar, svgEl, renderBars, clamp, reduceMotion, redrawers } = H;
  const $ = (id) => document.getElementById(id);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const h4 = (t) => el("h4", "", t);
  function explain(html) {
    const e = el("p", "explain");
    e.innerHTML = html;
    return e;
  }

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

  function cellColor(v, scale = 1) {
    const c = v >= 0 ? cssVar("--pos") : cssVar("--neg");
    return `color-mix(in srgb, ${c} ${Math.round(clamp(Math.abs(v) / scale, 0, 1) * 80)}%, transparent)`;
  }
  const fmt = (v, digits) => (v > -0.5 * 10 ** -digits ? "" : "−") + Math.abs(v).toFixed(digits);

  function vecRow(label, v, { cls = "", digits = 2, scale = 1 } = {}) {
    const row = el("div", "vrow " + cls);
    row.style.setProperty("--d", v.length);
    row.appendChild(el("span", "vlabel", label));
    v.forEach((x, d) => {
      const c = el("span", "vcell", fmt(x, digits));
      c.style.background = cellColor(x, scale);
      c.title = `d${d}: ${x.toFixed(4)}`;
      row.appendChild(c);
    });
    return row;
  }
  function headRow(n, label = "") {
    const row = el("div", "vrow head");
    row.style.setProperty("--d", n);
    row.appendChild(el("span", "vlabel", label));
    for (let d = 0; d < n; d++) row.appendChild(el("span", "vcell", "d" + d));
    return row;
  }
  function grid(rows, wide = true) {
    const g = el("div", "vgrid" + (wide ? " wide-label" : ""));
    rows.forEach((r) => g.appendChild(r));
    return g;
  }

  function makeStepper(stepperEl, stages, onGo) {
    stages.forEach((s, i) => {
      const li = el("li");
      const b = el("button");
      b.innerHTML = `<b>${s.icon}</b>${i + 1}. ${s.short}`;
      b.addEventListener("click", () => onGo(i));
      li.appendChild(b);
      stepperEl.appendChild(li);
    });
    return (i) => [...stepperEl.querySelectorAll("button")].forEach((b, k) => {
      b.classList.toggle("on", k === i);
      b.classList.toggle("done", k < i);
    });
  }

  /* ---------- Shared dataset ---------- */
  const VOCAB = [...new Set(CORPUS)];
  const V = VOCAB.length;
  const IDS = CORPUS.map((w) => VOCAB.indexOf(w));
  const showW = (w) => w;

  /* ================= 7. Dataset ================= */
  (function dataset() {
    const MIX = [
      { name: "Common Crawl (filtered web pages)", p: 60 },
      { name: "WebText2 (web pages linked from Reddit)", p: 22 },
      { name: "Books1", p: 8 },
      { name: "Books2", p: 8 },
      { name: "Wikipedia", p: 3 },
    ];
    const colors = ["--accent", "--accent-2", "--accent-3", "#fb923c", "#4ade80"];
    function renderMix() {
      const box = $("mixChart");
      box.innerHTML = "";
      const bar = el("div", "mix-bar");
      const legend = el("div", "mix-legend");
      MIX.forEach((m, i) => {
        const c = colors[i].startsWith("--") ? cssVar(colors[i]) : colors[i];
        const seg = el("div", "mix-seg", m.p >= 8 ? m.p + "%" : "");
        seg.style.width = m.p + "%";
        seg.style.background = c;
        seg.title = `${m.name}: ${m.p}% of training`;
        bar.appendChild(seg);
        const item = el("span");
        item.innerHTML = `<i style="background:${c}"></i>`;
        item.append(`${m.name} · ${m.p}%`);
        legend.appendChild(item);
      });
      box.append(bar, legend);
      box.appendChild(el("p", "note", "Share of training examples drawn from each source. Higher-quality sources (books, Wikipedia) are sampled more often than their size alone would give. Modern models also add code, scientific papers, maths and conversations."));
    }

    const RAW = [
      { text: "<html><nav>Home | About | Login</nav>", why: "website menu / HTML code" },
      { text: "<p>The cat sat on the mat.</p>", keep: "the cat sat on the mat ." },
      { text: "<p>The cat sat on the mat.</p>", why: "exact duplicate" },
      { text: "<p>BUY CHEAP W4TCHES!!! CLICK HERE >>></p>", why: "spam / low quality" },
      { text: "<p>The dog was happy.</p>", keep: "the dog was happy ." },
      { text: "<p>Email me at john.doe@example.com</p>", why: "personal information" },
      { text: "<p>The sun is warm and the sky is blue.</p>", keep: "the sun is warm and the sky is blue ." },
      { text: "<footer>© 2024 All rights reserved</footer></html>", why: "boilerplate footer" },
    ];

    const WINDOW = 6;
    const windows = [];
    for (let i = 0; i + WINDOW < IDS.length; i += WINDOW) windows.push(i);

    const hex2 = (n) => n.toString(16).padStart(2, "0");
    function wordBox(w, id, cls = "") {
      const b = el("span", "wbox " + cls);
      b.appendChild(el("b", "", showW(w)));
      if (id !== undefined) b.appendChild(el("small", "", String(id)));
      return b;
    }

    const STAGES = [
      {
        icon: "🌐", short: "Collect", title: "1. Collect raw text",
        desc: "Programs called crawlers download billions of web pages, plus books, Wikipedia, code and more. Raw web pages are messy: menus, ads, duplicates, spam, personal details.",
        render(body) {
          const pre = el("div", "raw-list");
          RAW.forEach((r, i) => {
            const line = el("div", "raw-line", r.text);
            line.style.animationDelay = i * 60 + "ms";
            pre.appendChild(line);
          });
          body.append(h4("A downloaded web page (raw)"), pre);
        },
      },
      {
        icon: "🧹", short: "Clean", title: "2. Clean and filter",
        desc: "Automatic filters strip HTML, remove duplicates, throw away spam and low-quality pages, and scrub personal information. Most of what is collected is thrown away (45 TB → 570 GB for GPT-3).",
        render(body) {
          const list = el("div", "raw-list");
          RAW.forEach((r, i) => {
            const line = el("div", "raw-line " + (r.keep ? "kept" : "dropped"));
            line.style.animationDelay = i * 60 + "ms";
            line.appendChild(el("span", "raw-text", r.keep || r.text));
            line.appendChild(el("span", "tag", r.keep ? "✓ kept" : "✗ " + r.why));
            list.appendChild(line);
          });
          const kept = RAW.filter((r) => r.keep).length;
          body.append(list, explain(`${kept} of ${RAW.length} lines survive. Our tiny demo dataset is ${CORPUS.length} words of clean text like this. You can see all of it in the next step.`));
        },
      },
      {
        icon: "#", short: "Tokenize", title: "3. Tokenize: every word becomes an ID",
        desc: "The cleaned text is turned into token IDs using the vocabulary. To keep it simple, our tiny dataset uses whole words as tokens, so its vocabulary is every distinct word: " + V + " entries, numbered 0 to " + (V - 1) + ".",
        render(body) {
          const vocab = el("div", "vocab-grid");
          VOCAB.forEach((w, i) => {
            const c = el("span", "vocab-item");
            c.appendChild(el("small", "", String(i)));
            c.append(" " + w);
            vocab.appendChild(c);
          });
          const flow = el("div", "wflow");
          CORPUS.slice(0, 40).forEach((w, i) => {
            const b = wordBox(w, IDS[i]);
            b.style.animationDelay = i * 25 + "ms";
            flow.appendChild(b);
          });
          flow.appendChild(el("span", "muted", ` … ${CORPUS.length - 40} more`));
          body.append(h4(`Vocabulary (${V} words)`), vocab, h4("The dataset as IDs (first 40 of " + CORPUS.length + " tokens)"), flow);
        },
      },
      {
        icon: "💾", short: "Store", title: "4. Store the IDs as binary files on disk",
        desc: "The IDs are written to disk as plain binary numbers: 2 bytes per token (uint16, enough for IDs up to 65,535; bigger vocabularies use 4 bytes). The files are split into many \"shards\" and kept on cloud storage, then streamed to the training computers.",
        render(body) {
          const bytes = [];
          IDS.forEach((id) => { bytes.push(id & 0xff, id >> 8); });
          const dump = el("div", "hexdump");
          const lines = 6;
          for (let l = 0; l < lines; l++) {
            const row = el("div", "hexline");
            row.appendChild(el("span", "off", (l * 16).toString(16).padStart(8, "0")));
            const hx = el("span", "hx");
            for (let k = 0; k < 16; k += 2) {
              const i = l * 16 + k;
              const pair = el("span", "pair " + ((i / 2) % 2 ? "b" : "a"), hex2(bytes[i]) + " " + hex2(bytes[i + 1]));
              pair.title = `token #${i / 2}: "${CORPUS[i / 2]}" = ID ${IDS[i / 2]}`;
              hx.appendChild(pair);
            }
            row.appendChild(hx);
            row.appendChild(el("span", "dec", CORPUS.slice(l * 8, l * 8 + 8).join(" ")));
            dump.appendChild(row);
          }
          dump.appendChild(el("div", "hexline muted", "…"));
          body.append(
            h4(`shard_00000.bin: ${CORPUS.length} tokens × 2 bytes = ${CORPUS.length * 2} bytes`),
            dump,
            explain(`Read it like this: the first two bytes <code>${hex2(bytes[0])} ${hex2(bytes[1])}</code> are the number ${IDS[0]} (little-endian: low byte first), which is the ID of "${CORPUS[0]}". The next two bytes are ${IDS[1]} = "${CORPUS[1]}", and so on. No letters are stored at all, just IDs. At real scale, GPT-3's 300 billion training tokens would take about 600 GB in this format.`),
          );
        },
      },
      {
        icon: "✂", short: "Examples", title: "5. Cut into training examples",
        desc: "The long stream of IDs is cut into windows (real models use 2,000–128,000 tokens per window; here, " + WINDOW + "). Each window holds many questions at once: at every position, \"given everything so far, what's the next token?\" The answers are just the same window shifted by one.",
        render(body) {
          windows.slice(0, 3).forEach((start, n) => {
            const box = el("div", "example");
            const inRow = el("div", "wflow");
            const outRow = el("div", "wflow");
            inRow.appendChild(el("span", "rowlab", "input"));
            outRow.appendChild(el("span", "rowlab", "target"));
            for (let k = 0; k < WINDOW; k++) {
              inRow.appendChild(wordBox(CORPUS[start + k], IDS[start + k]));
              outRow.appendChild(wordBox(CORPUS[start + k + 1], IDS[start + k + 1], "tgt"));
            }
            box.append(el("div", "ex-title", `Example ${n + 1} (tokens ${start}–${start + WINDOW})`), inRow, outRow);
            body.appendChild(box);
          });
          body.appendChild(explain(`Read each column top to bottom: after "<b>${CORPUS[0]}</b>" the answer is "<b>${CORPUS[1]}</b>"; after "${CORPUS[0]} ${CORPUS[1]}" the answer is "<b>${CORPUS[2]}</b>"… One window of ${WINDOW} = ${WINDOW} training questions. No human labels needed: the text is its own answer key.`));
        },
      },
      {
        icon: "🎲", short: "Batch", title: "6. Shuffle and batch",
        desc: "Examples are shuffled (so the model doesn't see topics in order) and grouped into batches that are processed in parallel on GPUs. One batch → one weight update. GPT-3 used batches of about 3.2 million tokens per update.",
        render(body) {
          const r = rng(7);
          const order = windows.slice();
          for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
          const table = el("table", "vocab-table batch-table");
          const head = el("tr");
          head.appendChild(el("th", "", ""));
          for (let k = 0; k < WINDOW; k++) head.appendChild(el("th", "", "pos " + k));
          const thead = el("thead");
          thead.appendChild(head);
          const tb = el("tbody");
          order.slice(0, 4).forEach((start, row) => {
            const tr = el("tr");
            tr.appendChild(el("td", "muted", "row " + row));
            for (let k = 0; k < WINDOW; k++) {
              const td = el("td");
              td.appendChild(el("b", "", String(IDS[start + k])));
              td.appendChild(el("small", "", " " + CORPUS[start + k]));
              tr.appendChild(td);
            }
            tb.appendChild(tr);
          });
          table.append(thead, tb);
          body.append(h4(`Batch 1: a 4 × ${WINDOW} grid of IDs (random windows from the dataset)`), el("div", "table-wrap"), explain("This grid of numbers is literally what gets sent to the GPU. Next: the model makes predictions for every cell, measures how wrong it was, and updates its weights. That's the live demo below."));
          body.querySelector(".table-wrap").appendChild(table);
        },
      },
    ];

    let stage = 0;
    const mark = makeStepper($("dsStepper"), STAGES, (i) => go(i));
    function go(i) {
      stage = clamp(i, 0, STAGES.length - 1);
      const s = STAGES[stage];
      $("dsBadge").textContent = `Step ${stage + 1} / ${STAGES.length}`;
      $("dsTitle").textContent = s.title;
      $("dsDesc").textContent = s.desc;
      const body = $("dsBody");
      const fresh = body.cloneNode(false);
      body.replaceWith(fresh);
      s.render(fresh);
      mark(stage);
      $("dsPrev").disabled = stage === 0;
      $("dsNext").disabled = stage === STAGES.length - 1;
    }
    $("dsPrev").addEventListener("click", () => go(stage - 1));
    $("dsNext").addEventListener("click", () => go(stage + 1));
    renderMix();
    go(0);
    redrawers.push(() => { renderMix(); go(stage); });
  })();

  /* ================= 8. Live training ================= */
  (function liveTraining() {
    const D = 8;
    const PAIRS = [];
    for (let i = 0; i + 1 < IDS.length; i++) PAIRS.push(i);
    const CATS = {
      animals: { color: "#22d3ee", label: "animals", words: ["cat", "dog", "mouse", "dogs", "animal"] },
      things: { color: "#a78bfa", label: "things & places", words: ["mat", "rug", "sun", "park", "sky", "text", "word", "data", "model", "ai", "patterns", "time", "walk", "friend"] },
      verbs: { color: "#fb923c", label: "actions (verbs)", words: ["sat", "was", "chased", "likes", "sleep", "play", "is", "reads", "learns", "predict", "writes", "trained", "predicts", "ran", "like", "learn"] },
      describe: { color: "#f472b6", label: "describing words", words: ["tired", "happy", "bright", "today", "warm", "blue", "small", "loyal", "full", "next", "one", "lot"] },
    };
    const catOf = (w) => {
      for (const k in CATS) if (CATS[k].words.includes(w)) return k;
      return "func";
    };
    const FUNC = { color: "#94a3b8", label: "small grammar words (the, on, .)" };

    let E, W, b, order, ptr, steps, lossHist, running = false, raf = 0, prevAxes = null;

    function reset() {
      const r = rng(2024);
      E = Array.from({ length: V }, () => Array.from({ length: D }, () => (r() * 2 - 1) * 0.5));
      W = Array.from({ length: D }, () => Array.from({ length: V }, () => (r() * 2 - 1) * 0.5));
      b = new Array(V).fill(0);
      order = shuffled(1);
      ptr = 0;
      steps = 0;
      lossHist = [{ s: 0, l: avgLoss() }];
      prevAxes = null;
      $("tlGen0").textContent = generate(rng(99));
    }
    function shuffled(seed) {
      const r = rng(seed);
      const o = PAIRS.slice();
      for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
      return o;
    }
    const lr = () => Number($("tlLr").value);

    function logitsFor(h, Wm = W, bm = b) {
      const z = bm.slice();
      for (let d = 0; d < D; d++) {
        const hd = h[d], row = Wm[d];
        for (let j = 0; j < V; j++) z[j] += hd * row[j];
      }
      return z;
    }
    function avgLoss() {
      let s = 0;
      for (const i of PAIRS) s -= Math.log(softmax(logitsFor(E[IDS[i]]))[IDS[i + 1]]);
      return s / PAIRS.length;
    }

    // Full calculation for one example, without changing anything.
    function analyse(pos) {
      const x = IDS[pos], t = IDS[pos + 1];
      const h = E[x].slice();
      const z = logitsFor(h);
      const p = softmax(z);
      const loss = -Math.log(p[t]);
      const dz = p.slice();
      dz[t] -= 1;
      const gE = new Array(D).fill(0);
      for (let d = 0; d < D; d++) for (let j = 0; j < V; j++) gE[d] += W[d][j] * dz[j];
      const a = lr();
      const hNew = h.map((v, d) => v - a * gE[d]);
      const W2 = W.map((row, d) => row.map((w, j) => w - a * h[d] * dz[j]));
      const b2 = b.map((v, j) => v - a * dz[j]);
      const pAfter = softmax(logitsFor(hNew, W2, b2));
      const rank = [...p].sort((u, v) => v - u).indexOf(p[t]) + 1;
      return { pos, x, t, h, z, p, loss, dz, gE, hNew, pAfter, rank, W2, b2 };
    }
    function apply(A) {
      E[A.x] = A.hNew;
      W = A.W2;
      b = A.b2;
    }
    function fastStep() {
      const pos = order[ptr];
      const x = IDS[pos], t = IDS[pos + 1];
      const h = E[x];
      const p = softmax(logitsFor(h));
      p[t] -= 1;
      const a = lr();
      const gE = new Array(D).fill(0);
      for (let d = 0; d < D; d++) {
        const row = W[d];
        let g = 0;
        for (let j = 0; j < V; j++) { g += row[j] * p[j]; row[j] -= a * h[d] * p[j]; }
        gE[d] = g;
      }
      for (let j = 0; j < V; j++) b[j] -= a * p[j];
      for (let d = 0; d < D; d++) h[d] -= a * gE[d];
      advance();
    }
    function advance() {
      steps++;
      ptr++;
      if (ptr >= order.length) { ptr = 0; order = shuffled(steps); }
      if (steps % 25 === 0) lossHist.push({ s: steps, l: avgLoss() });
    }

    function generate(r, n = 12) {
      const out = ["the"];
      let cur = VOCAB.indexOf("the");
      for (let k = 0; k < n; k++) {
        const p = softmax(logitsFor(E[cur]), 0.7);
        let u = r(), j = 0;
        for (; j < V - 1; j++) { u -= p[j]; if (u <= 0) break; }
        out.push(VOCAB[j]);
        cur = j;
      }
      return out.join(" ").replace(/ \./g, ".");
    }

    /* ---- detail view ---- */
    function renderDetail() {
      const A = analyse(order[ptr]);
      const box = $("tlDetail");
      box.innerHTML = "";
      const block = (n, title) => {
        const d = el("div", "dblock");
        d.appendChild(el("div", "dtitle", `${n}  ${title}`));
        box.appendChild(d);
        return d;
      };

      const b1 = block("①", "Pick an example from the dataset");
      const ctx = el("div", "corpus-snip");
      for (let k = Math.max(0, A.pos - 5); k <= Math.min(CORPUS.length - 1, A.pos + 5); k++) {
        const cls = k === A.pos ? "ctx" : k === A.pos + 1 ? "tgt" : "";
        ctx.appendChild(el("span", cls, CORPUS[k]));
        ctx.append(" ");
      }
      b1.append(ctx, el("p", "dnote", `Input: "${VOCAB[A.x]}" (ID ${A.x}). Correct next word: "${VOCAB[A.t]}" (ID ${A.t}).`));

      const b2 = block("②", `Look up row ${A.x} of the embedding table`);
      b2.append(grid([headRow(D, "row"), vecRow(`${A.x} ${VOCAB[A.x]}`, A.h, { cls: "hit" })]), el("p", "dnote", "This is the word's current vector. It's what the model \"knows\" about it so far."));

      const b3 = block("③", "Predict: score all " + V + " words → softmax");
      const bars = el("div", "bars");
      const top = A.p.map((p, j) => ({ name: VOCAB[j], p })).sort((u, v) => v.p - u.p).slice(0, 5);
      b3.append(bars, el("p", "dnote", `Score of each word = (row ② · its column in the output table) + bias. The correct word "${VOCAB[A.t]}" gets ${(A.p[A.t] * 100).toFixed(1)}%, rank ${A.rank} of ${V}.`));
      renderBars(bars, top, VOCAB[A.t]);

      const b4 = block("④", "Measure how wrong it was (the loss)");
      const meter = el("div", "loss-meter");
      const maxL = Math.log(V) * 1.4;
      const fill = el("div", "lm-fill");
      fill.style.width = clamp(A.loss / maxL, 0, 1) * 100 + "%";
      const mark = el("div", "lm-mark");
      mark.style.left = (Math.log(V) / maxL) * 100 + "%";
      mark.title = "random guessing";
      meter.append(fill, mark);
      b4.append(
        el("div", "big-formula", `loss = −ln(${A.p[A.t].toFixed(4)}) = ${A.loss.toFixed(3)}`),
        meter,
        el("p", "dnote", `0 = perfect (100% on the right word). ${Math.log(V).toFixed(2)} (marker) = random guessing among ${V} words.`),
      );

      const b5 = block("⑤", "Gradient: which way should each number move?");
      b5.append(
        grid([headRow(D, ""), vecRow("gradient", A.gE, { digits: 2, scale: 0.6 })]),
        el("p", "dnote", `Calculus (backpropagation) tells us how the loss changes if each number changes a little. Positive → decreasing that number lowers the loss. The ${D}×${V} output table and ${V} biases get gradients too (${D * V + V} more numbers, not shown).`),
      );

      const b6 = block("⑥", `Update: new = old − learning rate (${lr().toFixed(2)}) × gradient`);
      b6.append(
        grid([
          headRow(D, ""),
          vecRow("old row", A.h),
          vecRow("− lr × grad", A.gE.map((g) => -lr() * g), { scale: 0.3 }),
          vecRow("new row", A.hNew, { cls: "hit" }),
        ]),
        el("p", "dnote " + (A.pAfter[A.t] > A.p[A.t] ? "good" : ""), `After this update "${VOCAB[A.t]}" would get ${(A.pAfter[A.t] * 100).toFixed(1)}% (was ${(A.p[A.t] * 100).toFixed(1)}%). Slightly less wrong. Now repeat for the next example… millions of times.`),
      );
    }

    /* ---- map (PCA of the embedding table) ---- */
    function pcaAxes() {
      const mean = new Array(D).fill(0);
      E.forEach((r) => r.forEach((v, d) => (mean[d] += v / V)));
      const C = Array.from({ length: D }, () => new Array(D).fill(0));
      E.forEach((r) => {
        const c = r.map((v, d) => v - mean[d]);
        for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) C[i][j] += c[i] * c[j];
      });
      const axes = [];
      for (let k = 0; k < 2; k++) {
        let v = prevAxes ? prevAxes[k].slice() : Array.from({ length: D }, (_, d) => (d === k ? 1 : 0.1));
        for (let it = 0; it < 40; it++) {
          let nv = C.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
          axes.forEach((a) => { const dp = nv.reduce((s, x, j) => s + x * a[j], 0); nv = nv.map((x, j) => x - dp * a[j]); });
          const n = Math.hypot(...nv) || 1;
          v = nv.map((x) => x / n);
        }
        if (prevAxes && v.reduce((s, x, j) => s + x * prevAxes[k][j], 0) < 0) v = v.map((x) => -x);
        axes.push(v);
      }
      prevAxes = axes;
      return { mean, axes };
    }

    let mapNodes = null;
    function renderMap() {
      const svg = $("tlMap");
      const { mean, axes } = pcaAxes();
      const pts = E.map((r) => axes.map((a) => r.reduce((s, v, d) => s + (v - mean[d]) * a[d], 0)));
      const mx = Math.max(...pts.map((p) => Math.abs(p[0])), 0.01);
      const my = Math.max(...pts.map((p) => Math.abs(p[1])), 0.01);
      if (!mapNodes) {
        svg.innerHTML = "";
        svgEl("line", { x1: 300, y1: 20, x2: 300, y2: 400, stroke: cssVar("--border") }, svg);
        svgEl("line", { x1: 20, y1: 210, x2: 580, y2: 210, stroke: cssVar("--border") }, svg);
        mapNodes = VOCAB.map((w) => {
          const c = catOf(w);
          const color = c === "func" ? FUNC.color : CATS[c].color;
          const g = svgEl("g", { class: "mapnode" }, svg);
          svgEl("circle", { r: c === "func" ? 3.5 : 5, fill: color }, g);
          const t = svgEl("text", { x: 7, y: 4, "font-size": c === "func" ? 10 : 12, fill: cssVar("--text"), opacity: c === "func" ? 0.55 : 0.95 }, g);
          t.textContent = w;
          return g;
        });
        const lg = $("tlLegend");
        lg.innerHTML = "";
        [...Object.values(CATS), FUNC].forEach((c) => {
          const s = el("span");
          s.innerHTML = `<i style="background:${c.color}"></i>`;
          s.append(c.label);
          lg.appendChild(s);
        });
      }
      pts.forEach((p, i) => {
        const x = 300 + (p[0] / mx) * 250, y = 210 - (p[1] / my) * 175;
        mapNodes[i].setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)})`);
      });
    }

    function renderLossChart() {
      const svg = $("tlLossChart");
      svg.innerHTML = "";
      const Wd = 320, Hd = 170, pad = 28;
      const maxS = Math.max(lossHist[lossHist.length - 1].s, 500);
      const maxL = Math.max(Math.log(V) + 0.3, ...lossHist.map((h) => h.l));
      const x = (s) => pad + (s / maxS) * (Wd - pad - 8);
      const y = (l) => Hd - 20 - (l / maxL) * (Hd - 34);
      svgEl("line", { x1: pad, y1: Hd - 20, x2: Wd - 8, y2: Hd - 20, stroke: cssVar("--border") }, svg);
      const rnd = svgEl("line", { x1: pad, y1: y(Math.log(V)), x2: Wd - 8, y2: y(Math.log(V)), stroke: cssVar("--muted"), "stroke-dasharray": "4 4" }, svg);
      rnd.setAttribute("opacity", 0.7);
      const t1 = svgEl("text", { x: Wd - 10, y: y(Math.log(V)) - 5, "text-anchor": "end", "font-size": 10, fill: cssVar("--muted") }, svg);
      t1.textContent = "random guessing";
      const d = lossHist.map((h, i) => (i ? "L" : "M") + x(h.s).toFixed(1) + " " + y(h.l).toFixed(1)).join(" ");
      svgEl("path", { d, fill: "none", stroke: cssVar("--accent-3"), "stroke-width": 2.5 }, svg);
      const t2 = svgEl("text", { x: pad, y: Hd - 5, "font-size": 10, fill: cssVar("--muted") }, svg);
      t2.textContent = "0";
      const t3 = svgEl("text", { x: Wd - 8, y: Hd - 5, "font-size": 10, fill: cssVar("--muted"), "text-anchor": "end" }, svg);
      t3.textContent = `${maxS} steps`;
      [0, 1, 2, 3, 4].forEach((l) => {
        if (l > maxL) return;
        const t = svgEl("text", { x: pad - 6, y: y(l) + 3, "font-size": 10, fill: cssVar("--muted"), "text-anchor": "end" }, svg);
        t.textContent = l;
      });
    }

    function renderStats() {
      $("tlSteps").textContent = steps.toLocaleString();
      $("tlEpochs").textContent = (steps / PAIRS.length).toFixed(1);
      $("tlLoss").textContent = lossHist[lossHist.length - 1].l.toFixed(3);
      $("tlParams").textContent = (V * D + D * V + V).toLocaleString();
    }
    let genCounter = 0;
    function renderAll(full = true) {
      renderStats();
      renderMap();
      renderLossChart();
      if (full || ++genCounter % 30 === 0) $("tlGen").textContent = generate(rng(steps + 1));
      if (full) renderDetail();
    }

    function stop() {
      running = false;
      cancelAnimationFrame(raf);
      $("tlRun").textContent = "▶ Train fast";
      if (lossHist[lossHist.length - 1].s !== steps) lossHist.push({ s: steps, l: avgLoss() });
      renderAll(true);
    }
    function loop() {
      for (let k = 0; k < 40; k++) fastStep();
      renderAll(false);
      if (steps >= 20000) return stop();
      if (running) raf = requestAnimationFrame(loop);
    }

    $("tlStep").addEventListener("click", () => {
      if (running) stop();
      apply(analyse(order[ptr]));
      advance();
      if (lossHist[lossHist.length - 1].s !== steps) lossHist.push({ s: steps, l: avgLoss() });
      renderAll(true);
    });
    $("tlRun").addEventListener("click", () => {
      if (running) return stop();
      running = true;
      $("tlRun").textContent = "■ Pause";
      raf = requestAnimationFrame(loop);
    });
    $("tlReset").addEventListener("click", () => {
      if (running) stop();
      reset();
      mapNodes = null;
      renderAll(true);
    });
    $("tlLr").addEventListener("input", () => {
      $("tlLrVal").textContent = lr().toFixed(2);
      if (!running) renderDetail();
    });
    redrawers.push(() => { mapNodes = null; renderAll(true); });

    reset();
    renderAll(true);
  })();

  /* ================= 9. Storage ================= */
  (function storage() {
    // GPT-2 small, exactly as stored (weights tied: the same wte table is reused to score the output).
    const d = 768, L = 12;
    const tensors = [];
    const add = (name, shape, group) => tensors.push({ name, shape, group, n: shape.reduce((a, b) => a * b, 1) });
    add("wte.weight", [50257, d], "wte");
    add("wpe.weight", [1024, d], "wpe");
    for (let l = 0; l < L; l++) {
      add(`h.${l}.ln_1.weight`, [d], `attn${l}`); add(`h.${l}.ln_1.bias`, [d], `attn${l}`);
      add(`h.${l}.attn.c_attn.weight`, [d, 3 * d], `attn${l}`); add(`h.${l}.attn.c_attn.bias`, [3 * d], `attn${l}`);
      add(`h.${l}.attn.c_proj.weight`, [d, d], `attn${l}`); add(`h.${l}.attn.c_proj.bias`, [d], `attn${l}`);
      add(`h.${l}.ln_2.weight`, [d], `mlp${l}`); add(`h.${l}.ln_2.bias`, [d], `mlp${l}`);
      add(`h.${l}.mlp.c_fc.weight`, [d, 4 * d], `mlp${l}`); add(`h.${l}.mlp.c_fc.bias`, [4 * d], `mlp${l}`);
      add(`h.${l}.mlp.c_proj.weight`, [4 * d, d], `mlp${l}`); add(`h.${l}.mlp.c_proj.bias`, [d], `mlp${l}`);
    }
    add("ln_f.weight", [d], "lnf"); add("ln_f.bias", [d], "lnf");
    let off = 0;
    tensors.forEach((t) => { t.start = off; off += t.n * 4; t.end = off; });
    const TOTAL = tensors.reduce((s, t) => s + t.n, 0);

    const GROUPS = [];
    tensors.forEach((t) => {
      let g = GROUPS.find((x) => x.id === t.group);
      if (!g) {
        const l = t.group.replace(/\D/g, "");
        const label = t.group === "wte" ? "Token embedding table"
          : t.group === "wpe" ? "Position table"
          : t.group === "lnf" ? "Final norm"
          : t.group.startsWith("attn") ? `Layer ${l}: attention` : `Layer ${l}: feed-forward`;
        const kind = t.group.replace(/\d+/, "");
        g = { id: t.group, label, kind, tensors: [], n: 0 };
        GROUPS.push(g);
      }
      g.tensors.push(t);
      g.n += t.n;
    });
    const KIND_COLOR = { wte: "--accent-3", wpe: "--accent-2", attn: "--accent", mlp: "#4ade80", lnf: "#94a3b8" };
    const color = (k) => (KIND_COLOR[k].startsWith("--") ? cssVar(KIND_COLOR[k]) : KIND_COLOR[k]);
    const nf = (n) => n.toLocaleString();
    const mb = (bytes) => (bytes / 1e6).toFixed(1) + " MB";
    let selected = "wte";

    function renderFile() {
      const strip = $("fileStrip");
      strip.innerHTML = "";
      GROUPS.forEach((g) => {
        const seg = el("button", "fseg" + (g.id === selected ? " on" : ""));
        seg.style.flexGrow = g.n;
        seg.style.background = color(g.kind);
        seg.title = `${g.label}: ${nf(g.n)} numbers`;
        seg.setAttribute("role", "listitem");
        seg.setAttribute("aria-label", g.label);
        if (g.id === "wte") seg.textContent = "embedding table";
        seg.addEventListener("click", () => { selected = g.id; renderFile(); });
        strip.appendChild(seg);
      });
      const g = GROUPS.find((x) => x.id === selected);
      const info = $("fileInfo");
      info.innerHTML = "";
      const pct = ((g.n / TOTAL) * 100).toFixed(1);
      info.appendChild(el("div", "finfo-title", g.label));
      info.appendChild(el("p", "dnote", `${nf(g.n)} numbers = ${pct}% of the model · bytes ${nf(g.tensors[0].start)} → ${nf(g.tensors[g.tensors.length - 1].end)} of the data (${mb(g.n * 4)})`));
      const table = el("table", "vocab-table");
      table.innerHTML = "<thead><tr><th>tensor name</th><th>shape</th><th>numbers</th></tr></thead>";
      const tb = el("tbody");
      g.tensors.forEach((t) => {
        const tr = el("tr");
        tr.append(el("td", "", t.name), el("td", "", "[" + t.shape.join(" × ") + "]"), el("td", "", nf(t.n)));
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      info.appendChild(el("div", "table-wrap")).appendChild(table);
      if (g.id === "wte") info.appendChild(explain(`<b>This is the embedding table.</b> 50,257 rows (one per token in GPT-2's vocabulary) × 768 numbers. Token ID <code>k</code> lives at byte <code>k × 768 × 4</code> of this block. GPT-2 reuses this same table at the very end to score every possible next token.`));

      const lines = tensors.slice(0, 5).map((t) => `  "${t.name}": {"dtype": "F32", "shape": [${t.shape.join(", ")}], "data_offsets": [${t.start}, ${t.end}]}`);
      $("fileHeader").textContent = `{\n${lines.join(",\n")},\n  … ${tensors.length - 5} more tensors …\n}\n<then ${nf(off)} bytes of raw numbers>`;
    }

    function renderBytes() {
      const toks = H.tokenize($("bytesInput").value).slice(0, 8);
      const box = $("bytesTokens");
      box.innerHTML = "";
      if (!toks.length) { $("bytesView").innerHTML = ""; return; }
      let current = Math.min(Number(box.dataset.sel || 0), toks.length - 1);
      toks.forEach((t, i) => {
        const id = hash(t.toLowerCase()) % 100000;
        const chip = el("button", "chip-btn" + (i === current ? " on" : ""));
        chip.innerHTML = `<b></b> <small>ID ${id}</small>`;
        chip.firstChild.textContent = t.replace(/^ /, "·");
        chip.addEventListener("click", () => { box.dataset.sel = i; renderBytes(); });
        box.appendChild(chip);
      });
      const t = toks[current];
      const id = hash(t.toLowerCase()) % 100000;
      const vec = H.tokenVec(t);
      const D = vec.length;
      const rowBytes = D * 4;
      const offset = id * rowBytes;
      const buf = new DataView(new ArrayBuffer(rowBytes));
      vec.forEach((v, k) => buf.setFloat32(k * 4, v, true));

      const view = $("bytesView");
      view.innerHTML = "";
      view.appendChild(el("div", "big-formula", `offset = ID ${nf(id)} × ${D} numbers × 4 bytes = byte ${nf(offset)}  (0x${offset.toString(16).toUpperCase().padStart(8, "0")})`));
      view.appendChild(el("p", "dnote", `So the computer jumps straight to byte ${nf(offset)} of the embedding table and reads the next ${rowBytes} bytes. No searching: it's pure arithmetic, which is why a lookup is instant even with 100,000+ rows.`));

      const groups = el("div", "byte-groups");
      vec.forEach((v, k) => {
        const g = el("button", "bgroup");
        const hexs = [0, 1, 2, 3].map((j) => buf.getUint8(k * 4 + j).toString(16).padStart(2, "0")).join(" ");
        g.appendChild(el("span", "bo", "+" + k * 4));
        g.appendChild(el("span", "bh", hexs));
        g.appendChild(el("span", "bv", buf.getFloat32(k * 4, true).toFixed(4)));
        g.style.borderColor = cellColor(v);
        g.addEventListener("click", () => showBits(k));
        groups.appendChild(g);
      });
      view.append(h4(`The ${rowBytes} bytes of row ${nf(id)} ("${t.replace(/^ /, "·")}"): 8 numbers × 4 bytes (click one)`), groups);
      const bitsBox = el("div", "bits");
      view.appendChild(bitsBox);

      function showBits(k) {
        [...groups.children].forEach((c, j) => c.classList.toggle("on", j === k));
        const u = buf.getUint32(k * 4, true);
        const bits = u.toString(2).padStart(32, "0");
        const s = bits[0], e = bits.slice(1, 9), m = bits.slice(9);
        const ev = parseInt(e, 2);
        const mv = 1 + parseInt(m, 2) / 2 ** 23;
        bitsBox.innerHTML = "";
        const line = el("div", "bitline");
        line.append(el("span", "bs", s), el("span", "be", e), el("span", "bm", m));
        const val = buf.getFloat32(k * 4, true);
        bitsBox.append(
          h4(`d${k} = ${val.toFixed(6)} as 32 bits (IEEE-754 float32, stored little-endian so the bytes appear reversed)`),
          line,
          explain(ev === 0 && parseInt(m, 2) === 0
            ? "All zero bits = the number 0."
            : `<span class="bs-t">sign ${s}</span> (${s === "1" ? "negative" : "positive"}) · <span class="be-t">exponent ${ev}</span> → 2<sup>${ev}−127</sup> = 2<sup>${ev - 127}</sup> · <span class="bm-t">fraction</span> → 1.${m.replace(/0+$/, "") || "0"}₂ ≈ ${mv.toFixed(6)}<br>value = ${s === "1" ? "−" : ""}${mv.toFixed(6)} × 2<sup>${ev - 127}</sup> = <b>${val.toFixed(6)}</b>`),
        );
      }
      showBits(0);
    }

    function renderHw() {
      const box = $("hwFlow");
      box.innerHTML = "";
      const stages = [
        { icon: "💾", title: "Disk (SSD)", text: "model.safetensors sits here permanently: just a file of numbers, like the one above." },
        { icon: "🧠", title: "RAM", text: "When the program starts, the file is read (or memory-mapped) into the computer's memory." },
        { icon: "⚡", title: "GPU memory (VRAM)", text: "All weights are copied onto the GPU, where the maths happens. A token lookup reads one row at address = table start + ID × row size." },
      ];
      stages.forEach((s, i) => {
        const c = el("div", "hw-box");
        c.append(el("div", "hw-icon", s.icon), el("div", "hw-title", s.title), el("p", "", s.text));
        box.appendChild(c);
        if (i < stages.length - 1) box.appendChild(el("div", "hw-arrow", "→"));
      });
    }

    $("bytesInput").addEventListener("input", () => { $("bytesTokens").dataset.sel = 0; renderBytes(); });
    renderFile();
    renderBytes();
    renderHw();
    redrawers.push(() => { renderFile(); renderBytes(); });
  })();
})();
