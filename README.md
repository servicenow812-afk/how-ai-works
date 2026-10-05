# How AI Works

An interactive, visual walkthrough of how a large language model turns your words into an answer. It's a static site in plain HTML, CSS and JavaScript, with no build step and no dependencies.

## What's inside

**Full walkthrough.** Type a prompt and step through all 9 stages, using the same numbers the whole way: tokens → token IDs → embedding vectors → positional encoding → attention (real Q·K·V maths) → feed-forward layers ×2 → logits for every vocabulary word → softmax probabilities (with temperature) → sampling the next token. Then feed the picked word back in and run it again.

Then one deep-dive section per stage:

1. **Tokenize**: type any text and watch it split into tokens with IDs.
2. **Embed**: words plotted in a 2D "meaning space", plus the king − man + woman ≈ queen demo.
3. **Attend**: self-attention arcs and a full attention matrix for three different heads.
4. **Compute**: a small neural network (3‑5‑5‑3) that is actually trained in the browser, with an animated forward pass.
5. **Predict**: a tiny trigram language model that writes one word at a time, with a temperature slider.
6. **Learn**: gradient descent on a loss curve, with a learning-rate slider and a loss history chart.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Or just open `index.html` in a browser.

## Deploy

Enable **GitHub Pages** (Settings → Pages → Deploy from branch → select your branch, `/ (root)`).
