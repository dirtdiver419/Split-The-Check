// Image scaling done here instead of by the browser. Browsers shrink images
// differently (Safari's is rougher), and a rough shrink turns thin printed lines
// into speckles the reader mistakes for letters. Doing it ourselves means every
// browser hands the reader the same picture.

/** RGBA pixels to one brightness value per pixel. */
export function toGray(rgba, w, h) {
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  }
  return out;
}

/**
 * Weights for one axis. Shrinking averages every source pixel the output pixel
 * covers (by how much of it is covered). Enlarging blends the two nearest pixels.
 * Returns, per output pixel, the first source index and its weights.
 */
function axisWeights(n0, n) {
  const scale = n / n0;
  const out = new Array(n);
  for (let o = 0; o < n; o++) {
    if (scale < 1) {
      const a = o / scale;
      const b = Math.min(n0, (o + 1) / scale);
      const first = Math.floor(a);
      const ws = [];
      for (let i = first; i < b; i++) ws.push(Math.min(i + 1, b) - Math.max(i, a));
      const sum = ws.reduce((s, x) => s + x, 0) || 1;
      out[o] = { first, ws: ws.map((x) => x / sum) };
    } else {
      const c = Math.min(n0 - 1, Math.max(0, (o + 0.5) / scale - 0.5));
      const first = Math.min(n0 - 1, Math.floor(c));
      const t = c - first;
      out[o] = first + 1 < n0 ? { first, ws: [1 - t, t] } : { first, ws: [1] };
    }
  }
  return out;
}

/** Resize a brightness map from w0×h0 to w×h, one axis at a time. */
export function resampleGray(src, w0, h0, w, h) {
  if (w === w0 && h === h0) return src;
  const xw = axisWeights(w0, w);
  const tmp = new Float32Array(w * h0);
  for (let y = 0; y < h0; y++) {
    const row = y * w0;
    for (let x = 0; x < w; x++) {
      const { first, ws } = xw[x];
      let v = 0;
      for (let k = 0; k < ws.length; k++) v += src[row + first + k] * ws[k];
      tmp[y * w + x] = v;
    }
  }
  const yw = axisWeights(h0, h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const { first, ws } = yw[y];
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = 0; k < ws.length; k++) v += tmp[(first + k) * w + x] * ws[k];
      out[y * w + x] = v;
    }
  }
  return out;
}
