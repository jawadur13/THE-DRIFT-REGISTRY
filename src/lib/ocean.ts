/**
 * ocean.ts — a surface-drift model for the world ocean.
 * ---------------------------------------------------------------------------
 * This single module is the entire physical argument of the site. It runs in
 * two places and must agree with itself in both:
 *
 *   - Node, at build time, to compute the modelled trajectory printed on every
 *     case file in the registry.
 *   - The browser, at runtime, to power the Drift Simulator.
 *
 * It is a kinematic model, not a general circulation model. It reproduces the
 * shapes that matter for drift: the seven great rotations, the western boundary
 * jets, the equatorial bands, Ekman convergence into the gyre cores, and the
 * fact that an object riding high in the water is pushed by wind while an
 * object riding low is not.
 *
 * Units throughout: degrees per day. Longitude velocity is divided by cos(lat)
 * on output so that a "degree per day" means a great-circle degree.
 */

import {
  LAND_MASK_B64,
  LAND_MASK_W,
  LAND_MASK_H,
  LAND_CELLS_PER_DEGREE,
} from '../data/generated/landmask.ts';

/* -------------------------------------------------------------------------- */
/* Land mask                                                                  */
/* -------------------------------------------------------------------------- */

let maskBytes: Uint8Array | null = null;

function mask(): Uint8Array {
  if (maskBytes) return maskBytes;
  let bin: string;
  if (typeof atob === 'function') {
    bin = atob(LAND_MASK_B64);
  } else {
    bin = Buffer.from(LAND_MASK_B64, 'base64').toString('binary');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  maskBytes = out;
  return out;
}

/** Wrap a longitude into [-180, 180). */
export function wrapLon(lon: number): number {
  const x = (((lon + 180) % 360) + 360) % 360;
  return x - 180;
}

/** True if the 0.5 degree cell containing this point is land. */
export function isLand(lon: number, lat: number): boolean {
  if (lat > 90 || lat < -90) return true;
  const m = mask();
  const c = Math.floor((wrapLon(lon) + 180) * LAND_CELLS_PER_DEGREE);
  const r = Math.floor((90 - lat) * LAND_CELLS_PER_DEGREE);
  const col = c < 0 ? 0 : c >= LAND_MASK_W ? LAND_MASK_W - 1 : c;
  const row = r < 0 ? 0 : r >= LAND_MASK_H ? LAND_MASK_H - 1 : r;
  const bit = row * LAND_MASK_W + col;
  return (m[bit >> 3] & (0x80 >> (bit & 7))) !== 0;
}

/* -------------------------------------------------------------------------- */
/* Circulation definitions                                                    */
/* -------------------------------------------------------------------------- */

export interface Gyre {
  id: string;
  name: string;
  short: string;
  ocean: string;
  lon: number;
  lat: number;
  /** Semi-axes in degrees. */
  rx: number;
  ry: number;
  /** +1 clockwise, -1 anticlockwise. */
  spin: 1 | -1;
  /** Peak tangential speed, degrees/day. */
  k: number;
  /** Inward (Ekman) convergence as a fraction of k. */
  converge: number;
  /** Approximate circuit period in years, for display. */
  circuitYears: number;
  blurb: string;
}

export const GYRES: Gyre[] = [
  {
    id: 'np',
    name: 'North Pacific Subtropical Gyre',
    short: 'North Pacific',
    ocean: 'Pacific',
    lon: -175,
    lat: 28,
    rx: 62,
    ry: 17,
    spin: 1,
    k: 0.135,
    converge: 0.075,
    circuitYears: 3.2,
    blurb:
      'The largest closed circulation on the planet, and the one the Registry knows best. Its northern arm delivers to Alaska and British Columbia, its eastern arm turns south along California, and its core holds objects for decades.',
  },
  {
    id: 'sp',
    name: 'South Pacific Subtropical Gyre',
    short: 'South Pacific',
    ocean: 'Pacific',
    lon: -120,
    lat: -28,
    rx: 54,
    ry: 17,
    spin: -1,
    k: 0.115,
    converge: 0.13,
    circuitYears: 3.4,
    blurb:
      'The emptiest water on Earth. Its core sits near Point Nemo, the oceanic pole of inaccessibility, and an object that reaches it is effectively out of contact.',
  },
  {
    id: 'na',
    name: 'North Atlantic Subtropical Gyre',
    short: 'North Atlantic',
    ocean: 'Atlantic',
    lon: -45,
    lat: 28,
    rx: 32,
    ry: 16,
    spin: 1,
    k: 0.155,
    converge: 0.15,
    circuitYears: 2.1,
    blurb:
      'The fastest of the subtropical gyres, driven by the Gulf Stream on its western wall. A bottle released off Florida can reach Ireland inside fourteen months.',
  },
  {
    id: 'sa',
    name: 'South Atlantic Subtropical Gyre',
    short: 'South Atlantic',
    ocean: 'Atlantic',
    lon: -18,
    lat: -27,
    rx: 26,
    ry: 15,
    spin: -1,
    k: 0.115,
    converge: 0.12,
    circuitYears: 2.9,
    blurb:
      'Fed by the Agulhas leakage rounding the Cape. Objects entering from the Indian Ocean often make one lap and then exit north into the equatorial band.',
  },
  {
    id: 'io',
    name: 'Indian Ocean Subtropical Gyre',
    short: 'Indian Ocean',
    ocean: 'Indian',
    lon: 78,
    lat: -28,
    rx: 38,
    ry: 14,
    spin: -1,
    k: 0.125,
    converge: 0.13,
    circuitYears: 2.6,
    blurb:
      'Closed to the north by a continent and open to the south to the Southern Ocean. It leaks more than it holds, which is why the Registry rarely lists an object as dormant here.',
  },
  {
    id: 'nas',
    name: 'North Atlantic Subpolar Gyre',
    short: 'Subpolar Atlantic',
    ocean: 'Atlantic',
    lon: -38,
    lat: 57,
    rx: 22,
    ry: 9,
    spin: -1,
    k: 0.115,
    converge: 0.03,
    circuitYears: 1.7,
    blurb:
      'Cold, cyclonic and fast. It receives the tail of the North Atlantic Drift and hands objects to Iceland, the Faroes and southwest Norway with unusual reliability.',
  },
  {
    id: 'ak',
    name: 'Alaska Gyre',
    short: 'Alaska',
    ocean: 'Pacific',
    lon: -150,
    lat: 54,
    rx: 25,
    ry: 8,
    spin: -1,
    k: 0.115,
    converge: 0.025,
    circuitYears: 1.5,
    blurb:
      'A small anticlockwise rotation in the Gulf of Alaska. It is the reason so much of the Registry is written by beachcombers between Kodiak and Haida Gwaii.',
  },
];

export interface Band {
  lat: number;
  width: number;
  /** Positive = eastward. */
  u: number;
}

export const BANDS: Band[] = [
  { lat: -52, width: 11, u: 0.17 }, // Antarctic Circumpolar Current
  { lat: 12, width: 7, u: -0.18 }, // North Equatorial Current
  { lat: -6, width: 9, u: -0.2 }, // South Equatorial Current
  { lat: 6.5, width: 2.8, u: 0.17 }, // Equatorial Counter Current
];

export interface Jet {
  name: string;
  path: [number, number][];
  /** Peak speed, degrees/day. */
  k: number;
  /** Cross-stream half width, degrees. */
  w: number;
}

/**
 * Western boundary currents and their continuations. These are what make the
 * field recognisable; without them the gyres are featureless ovals.
 */
export const JETS: Jet[] = [
  {
    name: 'Gulf Stream',
    k: 1.1,
    w: 3.0,
    path: [
      [-80, 25],
      [-79.5, 30],
      [-76, 34],
      [-71, 37.5],
      [-62, 39.5],
      [-50, 42],
    ],
  },
  {
    name: 'North Atlantic Drift',
    k: 0.17,
    w: 5.0,
    path: [
      [-50, 42],
      [-38, 46],
      [-25, 49],
      [-14, 52],
      [-4, 56],
      [4, 60],
    ],
  },
  {
    name: 'Irminger Current',
    k: 0.13,
    w: 3.5,
    path: [
      [-25, 60],
      [-32, 62],
      [-40, 61],
      [-45, 58],
      [-48, 53],
    ],
  },
  {
    name: 'Canary Current',
    k: 0.13,
    w: 3.5,
    path: [
      [-11, 36],
      [-14, 30],
      [-18, 24],
      [-23, 17],
      [-28, 12],
    ],
  },
  {
    name: 'Kuroshio',
    k: 1.0,
    w: 3.0,
    path: [
      [124, 24],
      [130, 30],
      [138, 34],
      [145, 36],
      [155, 37.5],
      [168, 38],
    ],
  },
  {
    name: 'North Pacific Current',
    k: 0.14,
    w: 5.5,
    path: [
      [168, 38],
      [-178, 40],
      [-165, 42],
      [-148, 44],
      [-133, 45],
    ],
  },
  {
    name: 'Alaska Current',
    k: 0.15,
    w: 3.5,
    path: [
      [-133, 47],
      [-137, 53],
      [-146, 58],
      [-156, 58],
      [-165, 55],
    ],
  },
  {
    name: 'California Current',
    k: 0.12,
    w: 3.5,
    path: [
      [-127, 46],
      [-125, 39],
      [-121, 32],
      [-115, 25],
      [-110, 19],
    ],
  },
  {
    name: 'Agulhas Current',
    k: 0.9,
    w: 2.6,
    path: [
      [40, -24],
      [36, -30],
      [30, -35],
      [23, -37],
      [17, -38],
    ],
  },
  {
    name: 'Agulhas Return',
    k: 0.19,
    w: 3.2,
    path: [
      [17, -40],
      [26, -41],
      [38, -40],
      [52, -39],
      [66, -38],
    ],
  },
  {
    name: 'Brazil Current',
    k: 0.26,
    w: 3.0,
    path: [
      [-36, -12],
      [-42, -22],
      [-50, -30],
      [-55, -37],
      [-58, -42],
    ],
  },
  {
    name: 'Benguela Current',
    k: 0.14,
    w: 3.2,
    path: [
      [17, -33],
      [13, -26],
      [11, -19],
      [9, -12],
      [6, -6],
    ],
  },
  {
    name: 'East Australian Current',
    k: 0.36,
    w: 2.6,
    path: [
      [153, -25],
      [153, -31],
      [151, -37],
      [148, -41],
      [144, -44],
    ],
  },
  {
    name: 'Humboldt Current',
    k: 0.14,
    w: 3.4,
    path: [
      [-75, -42],
      [-74, -33],
      [-77, -24],
      [-81, -16],
      [-85, -8],
    ],
  },
  {
    name: 'Somali Current',
    k: 0.36,
    w: 2.6,
    path: [
      [45, 2],
      [50, 7],
      [55, 11],
      [61, 13],
      [67, 12],
    ],
  },
  {
    name: 'Leeuwin Current',
    k: 0.13,
    w: 2.6,
    path: [
      [114, -22],
      [113, -29],
      [116, -34],
      [123, -35],
      [130, -34],
    ],
  },
  {
    name: 'Oyashio',
    k: 0.2,
    w: 2.0,
    path: [
      [163, 56],
      [157, 51],
      [149, 45.5],
      [144, 41],
    ],
  },
  {
    name: 'Norwegian Coastal Current',
    k: 0.22,
    w: 2.0,
    path: [
      [4.5, 58.5],
      [5, 61],
      [8, 63],
      [12, 65.5],
      [17, 68.5],
      [24, 70.5],
      [31, 71],
    ],
  },
  {
    name: 'European Shelf Edge Current',
    k: 0.17,
    w: 2.2,
    path: [
      [-9.5, 45.5],
      [-11, 49],
      [-11.5, 52],
      [-10, 55.5],
      [-7, 58.5],
      [-2, 60.5],
    ],
  },
  {
    name: 'Labrador Current',
    k: 0.25,
    w: 2.6,
    path: [
      [-59, 60],
      [-56, 56],
      [-53, 52],
      [-51, 48],
      [-52, 44.5],
    ],
  },
  {
    name: 'Gulf of St Lawrence Outflow',
    k: 0.19,
    w: 1.8,
    path: [
      [-64, 49.2],
      [-61, 48],
      [-58, 47],
      [-55, 45.5],
      [-53, 43.5],
    ],
  },
  {
    name: 'West Greenland Current',
    k: 0.19,
    w: 2.0,
    path: [
      [-44, 60],
      [-49, 62],
      [-54, 65],
      [-56, 68],
    ],
  },
  {
    name: 'Malvinas Current',
    k: 0.3,
    w: 2.2,
    path: [
      [-61, -52],
      [-58, -46],
      [-54, -41],
      [-52, -37],
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Field evaluation                                                           */
/* -------------------------------------------------------------------------- */

const RAD = Math.PI / 180;

/** [amplitude, lon wavenumber, lat wavenumber, phase x, phase y, rad/day]. */
const EDDY_TERMS: [number, number, number, number, number, number][] = [
  [0.0048, 7.3, 5.1, 0.4, 1.7, 0.00698],
  [0.0019, 13.1, 9.7, 2.1, 0.3, 0.01164],
  [0.0008, 23.7, 17.3, 1.1, 2.6, 0.02094],
];

/** One tropical year, in days. */
const YEAR = 365.25;

/**
 * Seasonal migration of the wind belts, and with them the gyre centres and the
 * convergence zones. Peaks in the northern summer.
 */
function seasonalShift(t: number): number {
  return 1.3 * Math.sin((2 * Math.PI * (t - 60)) / YEAR);
}

/** Shortest signed longitude difference a - b, in [-180, 180). */
function dLon(a: number, b: number): number {
  return wrapLon(a - b);
}

export interface Flow {
  /** Longitude component, degrees of longitude per day. */
  u: number;
  /** Latitude component, degrees per day. */
  v: number;
}

const _e: Flow = { u: 0, v: 0 };

/**
 * Divergence-free pseudo-noise, taken as the curl of a scalar streamfunction
 * whose phases march slowly westward. The motion is not decoration: a steady
 * field has fixed points at the gyre centres, and anything that reaches one
 * parks there forever. Real mesoscale eddies propagate west at a few
 * centimetres per second, and that is enough to keep the ocean stirred.
 */
function eddy(lon: number, lat: number, t: number, out: Flow): void {
  const x = lon * RAD;
  const y = lat * RAD;
  let u = 0;
  let v = 0;
  for (const [a, f, g, p, q, w] of EDDY_TERMS) {
    const px = f * x + p + w * t;
    const py = g * y + q;
    u += a * g * Math.sin(px) * Math.cos(py);
    v += -a * f * Math.cos(px) * Math.sin(py);
  }
  out.u = u;
  out.v = v;
}

/** Distance from a point to a segment, plus the unit tangent of that segment. */
function segDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { d: number; tx: number; ty: number } {
  const dx = dLon(bx, ax);
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : (dLon(px, ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = dLon(px, ax) - t * dx;
  const cy = py - (ay + t * dy);
  const len = Math.sqrt(len2) || 1;
  return { d: Math.hypot(cx, cy), tx: dx / len, ty: dy / len };
}

/**
 * Surface current at a point, in degrees per day. `u` is already scaled for the
 * convergence of the meridians.
 */
export function currentAt(
  lon: number,
  lat: number,
  t = 0,
  out: Flow = { u: 0, v: 0 },
): Flow {
  let u = 0;
  let v = 0;
  const shift = seasonalShift(t);

  // Gyres: tangential rotation plus a weak inward Ekman drift.
  for (const g of GYRES) {
    const nx = dLon(lon, g.lon) / g.rx;
    const ny = (lat - (g.lat + shift)) / g.ry;
    const r2 = nx * nx + ny * ny;
    if (r2 > 4) continue;
    const w = Math.exp(-r2 * 1.15);
    const rot = g.k * w;
    u += g.spin * rot * ny;
    v += -g.spin * rot * nx;
    const conv = g.k * g.converge * w;
    u += -conv * nx;
    v += -conv * ny;
  }

  // Zonal bands.
  for (const b of BANDS) {
    const dy = (lat - (b.lat + shift * 0.7)) / b.width;
    if (dy * dy > 6) continue;
    u += b.u * Math.exp(-dy * dy);
  }

  // Boundary jets.
  for (const j of JETS) {
    let best = Infinity;
    let tx = 0;
    let ty = 0;
    for (let i = 0; i + 1 < j.path.length; i++) {
      const s = segDist(lon, lat, j.path[i][0], j.path[i][1], j.path[i + 1][0], j.path[i + 1][1]);
      if (s.d < best) {
        best = s.d;
        tx = s.tx;
        ty = s.ty;
      }
    }
    const dw = best / j.w;
    if (dw > 2.6) continue;
    const w = Math.exp(-dw * dw);
    u += j.k * w * tx;
    v += j.k * w * ty;
  }

  eddy(lon, lat, t, _e);
  u += _e.u;
  v += _e.v;

  // Damp towards the poles, where this model has nothing useful to say.
  const damp = Math.max(0, 1 - Math.max(0, Math.abs(lat) - 72) / 18);
  u *= damp;
  v *= damp;

  out.u = u / Math.max(Math.cos(lat * RAD), 0.35);
  out.v = v;
  return out;
}

/**
 * Surface wind, expressed directly as the drift it would impart to an object of
 * windage 1.0: trade easterlies, mid-latitude westerlies, polar easterlies, and
 * the meridional component that piles floating material into the gyre cores.
 */
export function windAt(
  _lon: number,
  lat: number,
  t = 0,
  out: Flow = { u: 0, v: 0 },
): Flow {
  const a = Math.abs(lat - seasonalShift(t) * 1.9);
  const zonal = -Math.sin(a * (Math.PI / 30));
  const sign = lat >= 0 ? 1 : -1;
  const cut = Math.max(0, 1 - Math.max(0, a - 78) / 12);
  out.u = (0.3 * zonal * cut) / Math.max(Math.cos(lat * RAD), 0.35);
  out.v = 0.11 * zonal * sign * cut;
  return out;
}

/* -------------------------------------------------------------------------- */
/* Object classes                                                             */
/* -------------------------------------------------------------------------- */

export interface DrifterKind {
  id: string;
  label: string;
  /** Fraction of wind drift the object takes on. 0 = pure water follower. */
  windage: number;
  /** Roughly how much of the object stands above the waterline. */
  freeboard: string;
  note: string;
}

export const DRIFTERS: DrifterKind[] = [
  {
    id: 'bottle',
    label: 'Drift bottle',
    windage: 0.04,
    freeboard: '8%',
    note: 'Glass, part filled with sand for trim. The Registry’s reference object since 1974.',
  },
  {
    id: 'shoe',
    label: 'Athletic shoe',
    windage: 0.06,
    freeboard: '15%',
    note: 'Rides low and waterlogged but stays buoyant for years. Follows the water almost exactly, which makes it excellent data.',
  },
  {
    id: 'lego',
    label: 'Moulded plastic piece',
    windage: 0.08,
    freeboard: '20%',
    note: 'Small, hard, near neutral. Effectively immortal, and beaches in enormous numbers.',
  },
  {
    id: 'glove',
    label: 'Hockey glove',
    windage: 0.14,
    freeboard: '30%',
    note: 'Traps air in the padding and sits proud of the surface. Noticeably wind-driven.',
  },
  {
    id: 'float',
    label: 'Glass fishing float',
    windage: 0.19,
    freeboard: '40%',
    note: 'A hollow sphere. Japanese floats crossed the Pacific on this profile for the better part of a century.',
  },
  {
    id: 'toy',
    label: 'Hollow bath toy',
    windage: 0.26,
    freeboard: '55%',
    note: 'Two of these released in the same wave can finish on different continents. The most wind-driven object the Registry holds in quantity.',
  },
  {
    id: 'card',
    label: 'Drift card',
    windage: 0.34,
    freeboard: '85%',
    note: 'A flat plastic postcard. Practically a sail. Released deliberately, in thousands, in order to be found.',
  },
];

export const drifterById = (id: string): DrifterKind =>
  DRIFTERS.find((d) => d.id === id) ?? DRIFTERS[0];

/* -------------------------------------------------------------------------- */
/* Integration                                                                */
/* -------------------------------------------------------------------------- */

/** Deterministic PRNG, so build-time and runtime tracks are identical. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _c: Flow = { u: 0, v: 0 };
const _w: Flow = { u: 0, v: 0 };

/** Total drift velocity for an object of a given windage. */
export function driftAt(
  lon: number,
  lat: number,
  windage: number,
  t = 0,
  out: Flow = { u: 0, v: 0 },
): Flow {
  currentAt(lon, lat, t, _c);
  windAt(lon, lat, t, _w);
  out.u = _c.u + _w.u * windage;
  out.v = _c.v + _w.v * windage;
  return out;
}

export interface Particle {
  lon: number;
  lat: number;
  /** Days elapsed since release. */
  days: number;
  beached: boolean;
  /** How many times the object has touched land and been lifted off again. */
  strandings: number;
}

/** Slide angles, in radians, tried in order when a step would hit land. */
const SLIDE = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05];

const _d: Flow = { u: 0, v: 0 };
const _d2: Flow = { u: 0, v: 0 };

/**
 * Advance one particle by `dt` days with a midpoint step, then resolve any
 * collision with land by trying to slide along the coast. A particle that finds
 * no water in any direction is beached and stops moving.
 *
 * `noise` adds an unseeded random walk; pass a `random` function for
 * reproducible results.
 */
export function advance(
  p: Particle,
  dt: number,
  windage: number,
  noise = 0,
  random: () => number = Math.random,
  /**
   * Probability that touching land ends the drift. 1 means a single object that
   * strands for good; a small value models a population in which most units
   * come ashore but some are lifted off again on the next tide.
   */
  strand = 1,
): void {
  if (p.beached) return;

  driftAt(p.lon, p.lat, windage, p.days, _d);
  const midLon = wrapLon(p.lon + _d.u * dt * 0.5);
  const midLat = Math.max(-89, Math.min(89, p.lat + _d.v * dt * 0.5));
  driftAt(midLon, midLat, windage, p.days + dt * 0.5, _d2);

  let du = _d2.u * dt;
  let dv = _d2.v * dt;

  if (noise > 0) {
    du += (random() - 0.5) * noise * dt;
    dv += (random() - 0.5) * noise * dt;
  }

  const len = Math.hypot(du, dv);
  if (len < 1e-9) {
    p.days += dt;
    return;
  }

  // Try straight on, then progressively oblique, to slide along a coast.
  for (const turn of SLIDE) {
    const cs = Math.cos(turn);
    const sn = Math.sin(turn);
    const nu = du * cs - dv * sn;
    const nv = du * sn + dv * cs;
    const lon = wrapLon(p.lon + nu);
    const lat = Math.max(-88, Math.min(88, p.lat + nv));
    if (!isLand(lon, lat)) {
      p.lon = lon;
      p.lat = lat;
      p.days += dt;
      return;
    }
  }

  // Cornered. Either this is where the object stops, or the sea takes it back.
  p.days += dt;
  if (strand >= 1 || random() < strand) {
    p.beached = true;
    return;
  }

  // Reflect back offshore, hard enough to clear the coastal cell so the object
  // does not simply grind along the shoreline racking up contacts.
  for (const scale of [1.6, 1.1, 0.7, 2.4]) {
    for (const turn of [0, 0.6, -0.6]) {
      const cs = Math.cos(turn);
      const sn = Math.sin(turn);
      const nu = -(du * cs - dv * sn) * scale;
      const nv = -(du * sn + dv * cs) * scale;
      const lon = wrapLon(p.lon + nu);
      const lat = Math.max(-88, Math.min(88, p.lat + nv));
      if (!isLand(lon, lat)) {
        p.lon = lon;
        p.lat = lat;
        p.strandings++;
        return;
      }
    }
  }

  p.beached = true;
}

export interface TrackResult {
  /** Sampled positions, [lon, lat]. */
  points: [number, number][];
  /** Days elapsed at each sampled position. */
  days: number[];
  beached: boolean;
  /** Day on which the particle beached, or null. */
  beachedAt: number | null;
  /** Land contacts survived before the end of the run. */
  strandings: number;
}

export interface TrackOptions {
  years?: number;
  windage?: number;
  /** Integration step, days. */
  dt?: number;
  /** Emit one point every N steps. */
  sample?: number;
  /** Random-walk magnitude, degrees/day. */
  noise?: number;
  seed?: number;
  /** Probability that a land contact ends the drift. */
  strand?: number;
}

/** Integrate a single trajectory from a release point. */
export function track(
  lon: number,
  lat: number,
  {
    years = 12,
    windage = 0.06,
    dt = 2,
    sample = 4,
    noise = 0,
    seed = 1,
    strand = 1,
  }: TrackOptions = {},
): TrackResult {
  const p: Particle = { lon: wrapLon(lon), lat, days: 0, beached: false, strandings: 0 };
  const points: [number, number][] = [[p.lon, p.lat]];
  const days: number[] = [0];
  const steps = Math.round((years * 365.25) / dt);
  const random = rng(seed);

  for (let i = 1; i <= steps; i++) {
    advance(p, dt, windage, noise, random, strand);
    if (i % sample === 0 || p.beached || i === steps) {
      points.push([p.lon, p.lat]);
      days.push(p.days);
    }
    if (p.beached) break;
  }

  return {
    points,
    days,
    beached: p.beached,
    beachedAt: p.beached ? p.days : null,
    strandings: p.strandings,
  };
}

/** Total great-circle distance along a track, in kilometres. */
export function trackLength(points: [number, number][]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    const dy = (y2 - y1) * RAD;
    const dx = dLon(x2, x1) * RAD * Math.cos(((y1 + y2) / 2) * RAD);
    km += Math.hypot(dx, dy) * 6371;
  }
  return km;
}

/** Which gyre, if any, currently holds a point. */
export function gyreAt(lon: number, lat: number, t = 0): Gyre | null {
  let best: Gyre | null = null;
  let bestR = 1.05;
  const shift = seasonalShift(t);
  for (const g of GYRES) {
    const nx = dLon(lon, g.lon) / g.rx;
    const ny = (lat - (g.lat + shift)) / g.ry;
    const r = Math.hypot(nx, ny);
    if (r < bestR) {
      bestR = r;
      best = g;
    }
  }
  return best;
}
