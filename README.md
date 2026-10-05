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

**Behind the scenes:**

7. **Dataset:** a real training mix (GPT-3), then the full data pipeline on a tiny real dataset: collect → clean → tokenize → store as binary (hex dump) → cut into training examples → shuffle into batches.
8. **Live training:** a real tiny language model (embedding table + output table, 1,037 parameters) trains in the browser. One step is shown in full: the example, the embedding row lookup, the prediction, the loss, the gradient and the update. You can watch the loss fall and the embedding map organize itself.
9. **Storage:** the real tensor layout of GPT-2's model file (where the embedding table sits), the exact bytes and float32 bits of one token's row, and how the weights get from disk to RAM to the GPU.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Or just open `index.html` in a browser.

## Deploy

Enable **GitHub Pages** (Settings → Pages → Deploy from branch → select your branch, `/ (root)`).
