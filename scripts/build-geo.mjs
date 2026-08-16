/**
 * build-geo.mjs
 * ---------------------------------------------------------------------------
 * Turns Natural Earth land polygons (via the `world-atlas` TopoJSON bundles)
 * into two build-time artefacts that ship inside the JS bundle:
 *
 *   1. Equirectangular SVG path strings for the world coastline, at two levels
 *      of detail, in "chart units": x = lon + 180, y = 90 - lat.
 *      => viewBox "0 0 360 180". No runtime projection, no runtime fetch.
 *
 *   2. A 0.5 degree land mask (720 x 360 bits, base64) used by the drift model
 *      for landfall detection, both at build time and in the browser.
 *
 * Output: src/data/generated/geo.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { feature } from 'topojson-client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src/data/generated');

const load = (f) =>
  JSON.parse(readFileSync(join(root, 'node_modules/world-atlas', f), 'utf8'));

/** Flatten a GeoJSON land FeatureCollection into a flat list of rings. */
function ringsOf(geojson) {
  const rings = [];
  const push = (geom) => {
    if (!geom) return;
    if (geom.type === 'Polygon') rings.push(...geom.coordinates);
    else if (geom.type === 'MultiPolygon')
      for (const poly of geom.coordinates) rings.push(...poly);
    else if (geom.type === 'GeometryCollection') geom.geometries.forEach(push);
  };
  for (const f of geojson.features ?? [geojson]) push(f.geometry ?? f);
  return rings;
}

/** Shoelace area in square degrees (sign ignored). */
const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return Math.abs(a / 2);
};

/** Iterative Douglas-Peucker. */
function simplify(points, tol) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (hi - lo < 2) continue;
    const [ax, ay] = points[lo];
    const [bx, by] = points[hi];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tol2;
    for (let i = lo + 1; i < hi; i++) {
      const [px, py] = points[i];
      let d;
      if (len2 === 0) {
        d = (px - ax) ** 2 + (py - ay) ** 2;
      } else {
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([lo, best], [best, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Rings -> SVG path in chart units, filtered by area and simplified. */
function toPath(rings, { minArea, tol, precision = 2 }) {
  const parts = [];
  let kept = 0;
  for (const ring of rings) {
    if (ringArea(ring) < minArea) continue;
    const pts = simplify(
      ring.map(([lon, lat]) => [lon + 180, 90 - lat]),
      tol,
    );
    if (pts.length < 3) continue;
    kept++;
    const seg = pts.map(([x, y]) => `${x.toFixed(precision)} ${y.toFixed(precision)}`);
    parts.push(`M${seg.join('L')}Z`);
  }
  return { d: parts.join(''), rings: kept };
}

/**
 * Even-odd scanline rasteriser. Correctly handles holes (inland seas) because
 * Natural Earth nests hole rings inside their parent polygons.
 */
function rasterise(rings, cellsPerDegree) {
  const W = 360 * cellsPerDegree;
  const H = 180 * cellsPerDegree;
  const bytes = new Uint8Array((W * H) >> 3);

  // Bucket edges by scanline row to avoid an O(rows x edges) sweep.
  const buckets = Array.from({ length: H }, () => []);
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j];
      const [x2, y2] = ring[i];
      if (y1 === y2) continue;
      const yLo = Math.min(y1, y2);
      const yHi = Math.max(y1, y2);
      // row centre latitude for row r is 90 - (r + 0.5)/cpd
      const rStart = Math.max(0, Math.ceil((90 - yHi) * cellsPerDegree - 0.5));
      const rEnd = Math.min(H - 1, Math.floor((90 - yLo) * cellsPerDegree - 0.5));
      for (let r = rStart; r <= rEnd; r++) buckets[r].push([x1, y1, x2, y2]);
    }
  }

  const xs = [];
  for (let r = 0; r < H; r++) {
    const lat = 90 - (r + 0.5) / cellsPerDegree;
    xs.length = 0;
    for (const [x1, y1, x2, y2] of buckets[r]) {
      if (lat < Math.min(y1, y2) || lat >= Math.max(y1, y2)) continue;
      xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const cLo = Math.max(0, Math.ceil((xs[k] + 180) * cellsPerDegree - 0.5));
      const cHi = Math.min(W - 1, Math.floor((xs[k + 1] + 180) * cellsPerDegree - 0.5));
      for (let c = cLo; c <= cHi; c++) {
        const bit = r * W + c;
        bytes[bit >> 3] |= 0x80 >> (bit & 7);
      }
    }
  }
  return { W, H, bytes };
}

// --- run -------------------------------------------------------------------
const land50 = feature(load('land-50m.json'), load('land-50m.json').objects.land);
const land110 = feature(load('land-110m.json'), load('land-110m.json').objects.land);

const rings50 = ringsOf(land50);
const rings110 = ringsOf(land110);

const detail = toPath(rings50, { minArea: 0.45, tol: 0.12 });
const mid = toPath(rings50, { minArea: 0.7, tol: 0.22, precision: 1 });
const simple = toPath(rings110, { minArea: 1.2, tol: 0.3, precision: 1 });

const CPD = 2; // 0.5 degree cells
const mask = rasterise(rings50, CPD);
const b64 = Buffer.from(mask.bytes).toString('base64');

let landCells = 0;
for (const b of mask.bytes) landCells += (b.toString(2).match(/1/g) || []).length;

mkdirSync(OUT, { recursive: true });

const banner = `// GENERATED by scripts/build-geo.mjs — do not edit.
// Source: Natural Earth via world-atlas (public domain).
// Chart units: x = lon + 180, y = 90 - lat  ->  viewBox "0 0 360 180"
`;

// Split into three modules so a page that only needs the thumbnail coastline
// does not pull the 1:50m path or the land mask into its bundle.
writeFileSync(
  join(OUT, 'coast-detail.ts'),
  `${banner}
/** Coastline at ~1:50m, ${detail.rings} rings. */
export const COAST_DETAIL = ${JSON.stringify(detail.d)};
`,
  'utf8',
);

writeFileSync(
  join(OUT, 'coast-mid.ts'),
  `${banner}
/** Coastline at ~1:50m, generalised. ${mid.rings} rings — regional charts. */
export const COAST_MID = ${JSON.stringify(mid.d)};
`,
  'utf8',
);

writeFileSync(
  join(OUT, 'coast-simple.ts'),
  `${banner}
/** Coastline at ~1:110m, ${simple.rings} rings — thumbnails and inline charts. */
export const COAST_SIMPLE = ${JSON.stringify(simple.d)};
`,
  'utf8',
);

writeFileSync(
  join(OUT, 'landmask.ts'),
  `${banner}
/** Land mask: ${mask.W}x${mask.H} bits (${1 / CPD} degree cells), row-major from 90N/180W. */
export const LAND_MASK_B64 = ${JSON.stringify(b64)};
export const LAND_MASK_W = ${mask.W};
export const LAND_MASK_H = ${mask.H};
export const LAND_CELLS_PER_DEGREE = ${CPD};
`,
  'utf8',
);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`geo  detail  ${detail.rings} rings  ${kb(detail.d.length)}`);
console.log(`geo  mid     ${mid.rings} rings  ${kb(mid.d.length)}`);
console.log(`geo  simple  ${simple.rings} rings  ${kb(simple.d.length)}`);
console.log(
  `mask ${mask.W}x${mask.H}  ${kb(b64.length)} b64  land ${(
    (landCells / (mask.W * mask.H)) * 100
  ).toFixed(1)}%`,
);
