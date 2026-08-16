/**
 * build-tracks.mjs
 * ---------------------------------------------------------------------------
 * Runs the drift model over every case file in the Registry and writes the
 * result to src/data/generated/tracks.ts.
 *
 * Nothing about an object's present position is authored by hand. It is solved
 * here, from the release point, the object's windage, and the number of days
 * that have passed, using exactly the same module the browser simulator uses.
 *
 * Each file is solved as an ENSEMBLE. A single trajectory is the wrong
 * abstraction for twenty-eight thousand bath toys: the interesting quantity is
 * not where "it" is but how the population spreads and what fraction of it is
 * still afloat. One member — the one nearest the ensemble's centre of mass at
 * the solution date — is promoted to "representative" and drawn heavier.
 *
 * We also compute the model's residual at every observed sighting: the closest
 * the modelled ensemble came to where a human actually found the thing, inside
 * a six-month window either side of the report. Those numbers are printed on
 * the case file. They are not flattering and they are not meant to be.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src/data/generated');

const ocean = await import('../src/lib/ocean.ts');
const { CASES } = await import('../src/data/cases.ts');

const { DRIFTERS, wrapLon, isLand, advance, gyreAt, trackLength, rng } = ocean;

/** Build date, frozen into the artefact as the Registry's "solution of record". */
const SOLVED_ISO = new Date().toISOString().slice(0, 10);
/** Extra years solved past the build date so the page can keep advancing. */
const HORIZON_YEARS = 8;
/** Ensemble members per file. */
const MEMBERS = 24;
/** Half-window for matching a modelled position to a reported sighting. */
const RESIDUAL_WINDOW_DAYS = 183;

const DAY = 86400000;
const RAD = Math.PI / 180;

const daysBetween = (a, b) =>
  (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY;

function haversine(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * SVG path in chart units (x = lon + 180, y = 90 - lat), broken wherever the
 * track crosses the antimeridian so it does not draw a line across the map.
 */
function toPath(points, from = 0, to = points.length - 1, prec = 2, maxPts = Infinity) {
  if (to <= from) return '';
  // Thin the vertex list before writing, so a decorative path costs a
  // decorative amount of bytes.
  const stride = Math.max(1, Math.ceil((to - from + 1) / maxPts));
  let d = '';
  let open = false;
  for (let i = from; i <= to; i += 1) {
    if (stride > 1 && (i - from) % stride !== 0 && i !== to) continue;
    const [lon, lat] = points[i];
    const x = (lon + 180).toFixed(prec);
    const y = (90 - lat).toFixed(prec);
    if (!open || Math.abs(lon - points[Math.max(from, i - stride)][0]) > 180) {
      d += `M${x} ${y}`;
      open = true;
    } else {
      d += `L${x} ${y}`;
    }
  }
  return d;
}

/** Fraction of a 1.5 degree neighbourhood that is water. */
function openness(lon, lat) {
  let water = 0;
  let n = 0;
  for (let dy = -1.5; dy <= 1.5; dy += 0.5) {
    for (let dx = -1.5; dx <= 1.5; dx += 0.5) {
      const nl = wrapLon(lon + dx / Math.max(Math.cos(lat * RAD), 0.2));
      const na = Math.max(-88, Math.min(88, lat + dy));
      if (!isLand(nl, na)) water++;
      n++;
    }
  }
  return water / n;
}

/**
 * Move a reported release position to open water. Reported positions are often
 * "off <place>", which at half-degree resolution can land inside a fjord or a
 * river mouth where the model has nothing sensible to say.
 */
function toWater(lon, lat) {
  if (!isLand(lon, lat) && openness(lon, lat) >= 0.8) return [lon, lat];
  let best = null;
  let bestScore = -Infinity;
  for (let r = 0.5; r <= 9; r += 0.5) {
    for (let a = 0; a < 360; a += 10) {
      const nl = wrapLon(lon + (r * Math.cos(a * RAD)) / Math.max(Math.cos(lat * RAD), 0.2));
      const na = Math.max(-88, Math.min(88, lat + r * Math.sin(a * RAD)));
      if (isLand(nl, na)) continue;
      const score = openness(nl, na) - r * 0.04;
      if (score > bestScore) {
        bestScore = score;
        best = [nl, na];
      }
    }
    if (best && bestScore > 0.92) break;
  }
  return best ?? [lon, lat];
}

/**
 * Stranding probability per land contact. A single identified object stops when
 * it comes ashore. A population of thousands keeps arriving for decades, so
 * most contacts have to be survivable for the model to reproduce the record.
 */
const strandFor = (c) => {
  if (c.strand !== undefined) return c.strand;
  // A single identified object stops when it comes ashore. A population of
  // thousands has a reservoir: most units strand, some are lifted off again,
  // and arrivals continue for decades. A representative particle has to be
  // allowed to survive hundreds of coastal contacts to reproduce that.
  if (c.class === 'II' || c.class === 'IV') return 0.3;
  if (c.class === 'III') return 0.012;
  return 0.004;
};

/** Integrate one ensemble member. */
function runMember(lon0, lat0, windage, strand, seed, steps, dt, sample, daysToNow) {
  const random = rng(seed >>> 0);
  const p = { lon: lon0, lat: lat0, days: 0, beached: false, strandings: 0 };
  const points = [[p.lon, p.lat]];
  const days = [0];
  let nowIndex = 0;

  for (let i = 1; i <= steps; i++) {
    advance(p, dt, windage, 0.014, random, strand);
    if (i % sample === 0 || p.beached || i === steps) {
      points.push([Number(p.lon.toFixed(3)), Number(p.lat.toFixed(3))]);
      days.push(Math.round(p.days));
      if (p.days <= daysToNow) nowIndex = points.length - 1;
    }
    if (p.beached) break;
  }
  if (p.beached && p.days <= daysToNow) nowIndex = points.length - 1;

  return {
    points,
    days,
    nowIndex,
    beached: p.beached,
    beachedDay: p.beached ? Math.round(p.days) : null,
    afloatNow: !(p.beached && p.days <= daysToNow),
    strandings: p.strandings,
  };
}

const out = {};
const report = [];

for (const c of CASES) {
  const kind = DRIFTERS.find((d) => d.id === c.drifter) ?? DRIFTERS[0];
  const [lon0, lat0] = toWater(c.release.lon, c.release.lat);
  const nudged =
    Math.abs(lon0 - c.release.lon) > 1e-6 || Math.abs(lat0 - c.release.lat) > 1e-6;

  const daysToNow = daysBetween(c.release.date, SOLVED_ISO);
  const totalDays = daysToNow + HORIZON_YEARS * 365.25;
  const dt = 2;
  const steps = Math.round(totalDays / dt);
  const sample = Math.max(1, Math.round(steps / 420));
  const strand = strandFor(c);

  // Members are scattered over a release box a few tens of kilometres across,
  // which is a fair description of how precisely any of these positions is
  // actually known.
  const spread = rng(c.seed * 97 + 13);
  const members = [];
  for (let m = 0; m < MEMBERS; m++) {
    const jx = m === 0 ? 0 : (spread() - 0.5) * 1.4;
    const jy = m === 0 ? 0 : (spread() - 0.5) * 1.0;
    let ml = wrapLon(lon0 + jx / Math.max(Math.cos(lat0 * RAD), 0.25));
    let ma = Math.max(-88, Math.min(88, lat0 + jy));
    if (isLand(ml, ma)) {
      ml = lon0;
      ma = lat0;
    }
    members.push(
      runMember(ml, ma, kind.windage, strand, c.seed * 2654435761 + m * 40503, steps, dt, sample, daysToNow),
    );
  }

  const afloat = members.filter((m) => m.afloatNow);

  /** Closest approach of one member to one reported find, and whether it was in window. */
  function approach(m, s) {
    const target = daysBetween(c.release.date, s.date);
    let best = Infinity;
    let fallback = Infinity;
    let fallbackGap = Infinity;
    for (let i = 0; i < m.points.length; i++) {
      const gap = Math.abs(m.days[i] - target);
      const d = haversine(m.points[i][0], m.points[i][1], s.lon, s.lat);
      if (gap <= RESIDUAL_WINDOW_DAYS) {
        if (d < best) best = d;
      } else if (gap < fallbackGap) {
        fallbackGap = gap;
        fallback = d;
      }
    }
    return Number.isFinite(best)
      ? { km: best, lapse: 0 }
      : { km: fallback, lapse: Math.round(fallbackGap) };
  }

  // Centre of mass of the ensemble at the solution date.
  const pool = afloat.length >= members.length / 2 ? afloat : members;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const m of pool) {
    const [lo, la] = m.points[m.nowIndex];
    sx += Math.cos(la * RAD) * Math.cos(lo * RAD);
    sy += Math.cos(la * RAD) * Math.sin(lo * RAD);
    sz += Math.sin(la * RAD);
  }
  const comLon = (Math.atan2(sy, sx) * 180) / Math.PI;
  const comLat = (Math.atan2(sz, Math.hypot(sx, sy)) * 180) / Math.PI;

  /**
   * The representative member is the one most consistent with the sighting log:
   * of twenty-four equally valid solutions, we draw the one that best explains
   * where people actually found the thing. Where a file has no sightings, we
   * fall back to the member nearest the ensemble centre of mass.
   *
   * The residuals printed on the case file are an ensemble property, not this
   * member's, so choosing it cannot flatter the numbers.
   */
  let rep = pool[0];
  let repScore = Infinity;
  for (const m of pool) {
    let score;
    if (c.sightings.length) {
      score =
        c.sightings.reduce((a, s) => {
          const r = approach(m, s);
          return a + r.km + r.lapse * 4;
        }, 0) / c.sightings.length;
    } else {
      const [lo, la] = m.points[m.nowIndex];
      score = haversine(lo, la, comLon, comLat);
    }
    if (score < repScore) {
      repScore = score;
      rep = m;
    }
  }

  // Ensemble spread: median distance from the centre of mass, in km.
  const dists = pool
    .map((m) => haversine(m.points[m.nowIndex][0], m.points[m.nowIndex][1], comLon, comLat))
    .sort((a, b) => a - b);
  const spreadKm = Math.round(dists[Math.floor(dists.length / 2)]);

  /**
   * Residual: the closest any ensemble member came to a reported find, within
   * six months either side of the report. Phase error dominates a chaotic
   * trajectory, so a same-day comparison measures the clock, not the map.
   */
  const residuals = c.sightings.map((s) => {
    let best = { km: Infinity, lapse: Infinity };
    for (const m of members) {
      const r = approach(m, s);
      if (r.lapse < best.lapse || (r.lapse === best.lapse && r.km < best.km)) best = r;
    }
    return { date: s.date, km: Math.round(best.km), lapse: best.lapse };
  });

  /**
   * Headline agreement is the MEDIAN residual, not the mean. Several files
   * carry a single far-flung report the Registry itself files as "probable" —
   * a Pacific toy on a Hebridean beach — and a mean lets one such entry stand
   * in for the whole record. The outliers are still shown, per sighting.
   */
  const scored = residuals.filter((r) => r.lapse === 0).map((r) => r.km).sort((a, b) => a - b);
  const skill = scored.length ? scored[Math.floor((scored.length - 1) / 2)] : null;
  const worst = scored.length ? scored[scored.length - 1] : null;

  const km = trackLength(rep.points.slice(0, rep.nowIndex + 1));
  const nowPos = rep.points[rep.nowIndex];
  const gyre = gyreAt(nowPos[0], nowPos[1], rep.days[rep.nowIndex]);

  /**
   * The status the ensemble alone would assign. Where this disagrees with the
   * status written on the file, the case page says so. An archive that quietly
   * edits its records to match its model is not an archive.
   */
  const afloatFrac = afloat.length / members.length;
  let modelStatus;
  if (afloatFrac < 0.5) modelStatus = 'grounded';
  else if (spreadKm > 1500) modelStatus = 'dispersed';
  else modelStatus = 'in-transit';

  /**
   * The model works in a coarser vocabulary than the archive. It cannot know
   * whether a grounded object was collected; it cannot tell a file that has
   * simply gone quiet from one that has come ashore; and it has no way at all
   * to judge dormancy, which is a cataloguer's claim about a convergence zone
   * rather than a measurement. Only genuine contradictions are worth printing.
   */
  const COMPATIBLE = {
    grounded: ['grounded', 'recovered', 'lost-to-record'],
    'in-transit': ['in-transit', 'dispersed', 'dormant'],
    dispersed: ['dispersed', 'in-transit', 'lost-to-record'],
  };
  const dissent = !COMPATIBLE[modelStatus].includes(c.status);

  out[c.code] = {
    modelStatus,
    dissent,
    points: rep.points,
    days: rep.days,
    nowIndex: rep.nowIndex,
    /**
     * Low-resolution paths for the other members. Fifteen ghost tracks read as
     * the same cloud as twenty-three and cost a third of the bytes.
     */
    ensemble: members
      .filter((m) => m !== rep)
      .slice(0, 15)
      .map((m) => toPath(m.points, 0, m.nowIndex, 1, 90)),
    members: MEMBERS,
    afloat: afloat.length,
    spreadKm,
    com: [Number(comLon.toFixed(2)), Number(comLat.toFixed(2))],
    windage: kind.windage,
    drifterLabel: kind.label,
    releaseNudged: nudged,
    release: [Number(lon0.toFixed(3)), Number(lat0.toFixed(3))],
    beached: rep.beached,
    beachedDay: rep.beachedDay,
    beachedAt: rep.beached ? rep.points[rep.points.length - 1] : null,
    beachedBeforeNow: !rep.afloatNow,
    strandings: rep.strandings,
    strand,
    km: Math.round(km),
    // Divide by the time the representative was actually at sea, not by the
    // time since release — otherwise an object that grounded in 1959 is
    // reported as having moved at a tenth of a kilometre a day ever since.
    kmPerDay: Number(
      (km / Math.max(1, Math.min(daysToNow, rep.beachedDay ?? daysToNow))).toFixed(1),
    ),
    daysAdrift: Math.round(daysToNow),
    now: nowPos,
    gyre: gyre ? gyre.id : null,
    residuals,
    skill,
    worst,
    pathAll: toPath(rep.points),
    pathToNow: toPath(rep.points, 0, rep.nowIndex),
    /**
     * The last fifth of the drift, drawn heavier on top of the whole track.
     * A file thirty years old orbits its gyre a dozen times, and without this
     * the plate is a ball of wool with no way to tell one end from the other.
     */
    pathRecent: toPath(rep.points, Math.floor(rep.nowIndex * 0.8), rep.nowIndex),
    /** Thinned path for index pages and the world chart. */
    pathLite: toPath(rep.points, 0, rep.nowIndex, 1, 90),
  };

  report.push(
    `${c.code} ${String(kind.id).padEnd(6)} w=${kind.windage.toFixed(2)} ` +
      `afloat ${String(afloat.length).padStart(2)}/${MEMBERS} ` +
      `spread ${String(spreadKm).padStart(5)}km ` +
      `now ${(nowPos[0].toFixed(1) + ',' + nowPos[1].toFixed(1)).padStart(14)} ` +
      `${String(out[c.code].kmPerDay).padStart(5)}km/d ` +
      `gyre ${(gyre ? gyre.id : '--').padEnd(3)} ` +
      `resid ${skill === null ? '    -' : String(skill).padStart(5) + 'km'} ` +
      `model=${modelStatus}${dissent ? '  ** DISSENT vs ' + c.status : ''}`,
  );
}

mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, 'tracks.ts'),
  `// GENERATED by scripts/build-tracks.mjs — do not edit.
// Solved ${SOLVED_ISO} against src/lib/ocean.ts, ${MEMBERS} members per file.

export interface Residual {
  date: string;
  /** Closest approach of the ensemble to the reported find, km. */
  km: number;
  /** Days the report falls outside the modelled window, or 0 if inside it. */
  lapse: number;
}

export interface Track {
  /** Status the ensemble alone implies, which may contradict the file. */
  modelStatus: 'in-transit' | 'grounded' | 'dispersed';
  /** True when the modelled status genuinely contradicts the filed status. */
  dissent: boolean;
  /** Representative member. */
  points: [number, number][];
  days: number[];
  /** Index of the last representative point on or before the solution date. */
  nowIndex: number;
  /** Low-resolution SVG paths for the remaining ensemble members. */
  ensemble: string[];
  members: number;
  /** Members still afloat at the solution date. */
  afloat: number;
  /** Median distance of surviving members from the ensemble centre of mass, km. */
  spreadKm: number;
  com: [number, number];
  windage: number;
  drifterLabel: string;
  releaseNudged: boolean;
  release: [number, number];
  beached: boolean;
  beachedDay: number | null;
  beachedAt: [number, number] | null;
  beachedBeforeNow: boolean;
  strandings: number;
  strand: number;
  /** Distance travelled by the representative member up to the solution date. */
  km: number;
  kmPerDay: number;
  daysAdrift: number;
  now: [number, number];
  gyre: string | null;
  residuals: Residual[];
  /** Median residual across reported sightings inside the modelled window, km. */
  skill: number | null;
  /** Largest residual among those sightings, km. */
  worst: number | null;
  pathAll: string;
  pathToNow: string;
  /** The most recent fifth of the drift, for emphasis. */
  pathRecent: string;
  /** Thinned representative path, for index pages and thumbnails. */
  pathLite: string;
}

/** Date the Registry last re-solved every open file. */
export const SOLVED_ON = ${JSON.stringify(SOLVED_ISO)};
export const ENSEMBLE_MEMBERS = ${MEMBERS};
export const RESIDUAL_WINDOW_DAYS = ${RESIDUAL_WINDOW_DAYS};

export const TRACKS: Record<string, Track> = ${JSON.stringify(out)};

export const trackFor = (code: string): Track => TRACKS[code];
`,
  'utf8',
);

console.log(report.join('\n'));
console.log(`\nsolved ${CASES.length} files, ${MEMBERS} members each, against ${SOLVED_ISO}`);
