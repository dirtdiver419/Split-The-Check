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

/**
 * How far the printed lines lean, in degrees. Positive means the right side is
 * lower (turned clockwise). Works on a cleaned-up brightness map (paper near white):
 * the dark pixels are projected onto the vertical axis at each trial angle, and the
 * angle where the rows of text stack up most sharply wins. Returns 0 when there's
 * too little ink to tell or no angle stands out.
 */
export function measureSkew(lum, w, h, { max = 20 } = {}) {
  // Work small: about 700px on the long side is plenty to find the lines.
  const s = Math.min(1, 700 / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * s));
  const sh = Math.max(1, Math.round(h * s));
  const small = s < 1 ? resampleGray(lum, w, h, sw, sh) : lum;
  const xs = [];
  const ys = [];
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (small[y * sw + x] < 140) { xs.push(x - sw / 2); ys.push(y); }
  if (xs.length < 200) return 0;
  const step = Math.max(1, Math.floor(xs.length / 60000));
  const reach = Math.ceil(Math.hypot(sw, sh)) + 2;
  const bins = new Float64Array(reach * 2);
  const score = (deg) => {
    const t = (deg * Math.PI) / 180;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    bins.fill(0);
    for (let i = 0; i < xs.length; i += step) bins[Math.round(ys[i] * c - xs[i] * sn) + reach]++;
    let sum = 0;
    for (let i = 0; i < bins.length; i++) sum += bins[i] * bins[i];
    return sum;
  };
  let best = 0;
  let bestScore = -1;
  for (let d = -max; d <= max; d += 0.5) {
    const v = score(d);
    if (v > bestScore) { bestScore = v; best = d; }
  }
  for (let d = best - 0.5; d <= best + 0.5; d += 0.1) {
    const v = score(d);
    if (v > bestScore) { bestScore = v; best = d; }
  }
  // Only trust a lean that is clearly sharper than reading it as level.
  if (bestScore < score(0) * 1.05) return 0;
  return Math.round(best * 10) / 10;
}
