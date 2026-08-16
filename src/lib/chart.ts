/**
 * chart.ts — the projection the whole site draws in.
 *
 * Plate carrée, in "chart units": x = lon + 180, y = 90 - lat, so the whole
 * world is the rectangle 0,0 360,180 and every SVG on the site shares one
 * coordinate system. No runtime projection maths, no reflow on resize.
 */

export const cx = (lon: number): number => lon + 180;
export const cy = (lat: number): number => 90 - lat;

export interface Frame {
  lonFrom: number;
  lonTo: number;
  latFrom: number;
  latTo: number;
}

/** The default world frame: drops most of Antarctica and the high Arctic. */
export const WORLD: Frame = { lonFrom: -180, lonTo: 180, latFrom: -68, latTo: 82 };

export const viewBox = (f: Frame): string =>
  `${cx(f.lonFrom)} ${cy(f.latTo)} ${f.lonTo - f.lonFrom} ${f.latTo - f.latFrom}`;

export const aspect = (f: Frame): number =>
  (f.lonTo - f.lonFrom) / (f.latTo - f.latFrom);

/** A frame that contains every given point, padded and clamped to the globe. */
export function frameAround(
  points: [number, number][],
  pad = 12,
  minSpan = 46,
): Frame {
  if (!points.length) return WORLD;

  // Work in unwrapped longitude so a track crossing the antimeridian does not
  // produce a frame spanning the whole planet.
  let acc = points[0][0];
  const lons = [acc];
  for (let i = 1; i < points.length; i++) {
    // Shortest step from the running unwrapped longitude to the next point.
    const d = ((points[i][0] - acc + 540) % 360) - 180;
    acc += d;
    lons.push(acc);
  }

  let lo = Math.min(...lons);
  let hi = Math.max(...lons);
  let la = Math.min(...points.map((p) => p[1]));
  let lb = Math.max(...points.map((p) => p[1]));

  lo -= pad;
  hi += pad;
  la -= pad * 0.6;
  lb += pad * 0.6;

  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  if (lb - la < minSpan * 0.5) {
    const mid = (lb + la) / 2;
    la = mid - minSpan * 0.25;
    lb = mid + minSpan * 0.25;
  }

  if (hi - lo >= 360) {
    lo = -180;
    hi = 180;
  }
  la = Math.max(-85, la);
  lb = Math.min(85, lb);

  return { lonFrom: lo, lonTo: hi, latFrom: la, latTo: lb };
}

/**
 * Graticule path for a frame. Longitude lines are drawn in the frame's own
 * unwrapped space so a Pacific-centred frame still gets its meridians.
 */
export function graticule(f: Frame, lonStep = 30, latStep = 20): string {
  let d = '';
  const x0 = cx(f.lonFrom);
  const x1 = cx(f.lonTo);
  const y0 = cy(f.latTo);
  const y1 = cy(f.latFrom);

  const firstLon = Math.ceil(f.lonFrom / lonStep) * lonStep;
  for (let lon = firstLon; lon <= f.lonTo; lon += lonStep) {
    const x = cx(lon);
    d += `M${x} ${y0}V${y1}`;
  }

  const firstLat = Math.ceil(f.latFrom / latStep) * latStep;
  for (let lat = firstLat; lat <= f.latTo; lat += latStep) {
    if (lat === 0) continue;
    const y = cy(lat);
    d += `M${x0} ${y}H${x1}`;
  }
  return d;
}

/** The equator, drawn separately so it can be emphasised. */
export function equator(f: Frame): string {
  if (f.latFrom > 0 || f.latTo < 0) return '';
  return `M${cx(f.lonFrom)} ${cy(0)}H${cx(f.lonTo)}`;
}

/**
 * Longitude offsets to repeat a shape at, so a frame that runs past the
 * antimeridian still shows the coastline on both sides of the seam.
 */
export function wrapOffsets(f: Frame): number[] {
  const out = [0];
  if (f.lonFrom < -180) out.push(-360);
  if (f.lonTo > 180) out.push(360);
  return out;
}

/** True if a point falls inside a frame, respecting unwrapped longitudes. */
export function contains(f: Frame, lon: number, lat: number): boolean {
  if (lat < f.latFrom || lat > f.latTo) return false;
  for (const shift of [-360, 0, 360]) {
    const x = lon + shift;
    if (x >= f.lonFrom && x <= f.lonTo) return true;
  }
  return false;
}

export const frameWidth = (f: Frame): number => f.lonTo - f.lonFrom;

/**
 * Choose a chart frame for a case file.
 *
 * A single far-flung report — the Registry files several as "probable" — would
 * otherwise force a whole-world view and reduce the actual drift to a smudge.
 * We frame on the modelled track, widen to take in the finds when that is
 * cheap, and leave the outliers off the plate rather than ruin the plate.
 */
export function caseFrame(
  track: [number, number][],
  finds: [number, number][],
): { frame: Frame; dropped: number } {
  const tight = frameAround(track, 10);
  if (!finds.length) return { frame: tight, dropped: 0 };

  const wide = frameAround([...track, ...finds], 10);
  if (frameWidth(wide) <= frameWidth(tight) * 2.1) {
    return { frame: wide, dropped: 0 };
  }
  const dropped = finds.filter((f) => !contains(tight, f[0], f[1])).length;
  return { frame: tight, dropped };
}

/** Format a latitude/longitude for display. */
export const fmtLat = (lat: number): string =>
  `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
export const fmtLon = (lon: number): string =>
  `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
