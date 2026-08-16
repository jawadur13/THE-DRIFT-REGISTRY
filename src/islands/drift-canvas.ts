/**
 * drift-canvas.ts — the live surface of the Registry.
 *
 * One class, used twice: as the ambient flow field behind the front page, and
 * as the interactive Drift Simulator.
 *
 * Two things move on this canvas and they are computed differently on purpose:
 *
 *   • The BACKGROUND field is thousands of massless tracers advected through a
 *     cached 2-degree lookup of the current. It exists to be looked at. The
 *     cache is rebuilt a few times a second, which is thousands of times more
 *     often than the field it approximates actually changes.
 *
 *   • RELEASED objects are integrated against the exact model in ocean.ts, with
 *     the same land mask, the same stranding rule and the same windage table
 *     used to solve every case file in the registry at build time. What you get
 *     here is what the archive would get.
 */
import {
  driftAt,
  currentAt,
  isLand,
  wrapLon,
  gyreAt,
  rng,
  type Flow,
} from '../lib/ocean.ts';
import { cx, cy, type Frame } from '../lib/chart.ts';
import { COAST_DETAIL } from '../data/generated/coast-detail.ts';

export interface GroupState {
  tint: number;
  label: string;
  windage: number;
  released: number;
  afloat: number;
  spreadKm: number;
  furthestKm: number;
}

export interface SimState {
  days: number;
  released: number;
  afloat: number;
  beached: number;
  /** Median distance of the afloat population from its release point, km. */
  spreadKm: number;
  /** Gyre id currently holding the largest share of the afloat population. */
  gyre: string | null;
  gyreName: string | null;
  /** Longest distance travelled by any single unit, km. */
  furthestKm: number;
  running: boolean;
  done: boolean;
  groups: GroupState[];
}

interface Tracer {
  lon: number;
  lat: number;
  /** Steps remaining before this tracer is recycled. */
  life: number;
}

interface Unit {
  lon: number;
  lat: number;
  lon0: number;
  lat0: number;
  km: number;
  beached: boolean;
  /** Sampled positions, flat [lon, lat, lon, lat, ...]. */
  trail: number[];
  windage: number;
  /** Which release group this unit belongs to, for the matched-pair test. */
  tint: number;
  label: string;
}

const RAD = Math.PI / 180;
const HORIZON_DAYS = 20 * 365.25;
/** Simulation days per integration step. */
const STEP_DAYS = 2;

function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = wrapLon(lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Read a themed colour from the document, so the canvas follows the palette. */
function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export interface DriftCanvasOptions {
  canvas: HTMLCanvasElement;
  frame: Frame;
  mode: 'ambient' | 'sim';
  /** Background tracer count at 1600 CSS px wide; scaled by area. */
  density?: number;
  onState?: (s: SimState) => void;
}

export class DriftCanvas {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private frame: Frame;
  private mode: 'ambient' | 'sim';
  private density: number;
  private onState?: (s: SimState) => void;

  private w = 0;
  private h = 0;
  private dpr = 1;
  /** Chart units per CSS pixel. */
  private scale = 1;
  /** View offset in degrees, from dragging. */
  private panLon = 0;
  private panLat = 0;

  private tracers: Tracer[] = [];
  private units: Unit[] = [];
  private land = new Path2D(COAST_DETAIL);

  private days = 0;
  private running = false;
  private raf = 0;
  private lastT = 0;
  /** Simulation days advanced per real second. */
  private speed = 90;
  private reduced = false;

  /** Cached current field, [u, v] pairs on a lon/lat grid. */
  private grid: Float32Array | null = null;
  private gw = 0;
  private gh = 0;
  private gridStep = 2;
  private gridDay = -1e9;

  private colors = {
    sea: '#dde8e7',
    land: '#e2d9c4',
    coast: 'rgba(12,38,52,.35)',
    tracer: '#14647f',
    unit: '#bd4324',
    unit2: '#2c6a55',
    beached: '#9a6a15',
  };

  private ro?: ResizeObserver;
  private io?: IntersectionObserver;
  private visible = true;
  private themeHandler = () => {
    this.readColors();
    this.paintBase();
  };

  constructor(opts: DriftCanvasOptions) {
    this.cv = opts.canvas;
    const ctx = this.cv.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.frame = opts.frame;
    this.mode = opts.mode;
    this.density = opts.density ?? 2600;
    this.onState = opts.onState;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.readColors();
    this.resize();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.cv);

    this.io = new IntersectionObserver(
      ([e]) => {
        this.visible = e.isIntersecting;
        if (this.visible && this.running) this.tick(performance.now());
      },
      { threshold: 0 },
    );
    this.io.observe(this.cv);

    window.addEventListener('dr:theme', this.themeHandler);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.io?.disconnect();
    window.removeEventListener('dr:theme', this.themeHandler);
  }

  /* --- geometry --------------------------------------------------------- */

  private resize(): void {
    const rect = this.cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = rect.width;
    this.h = rect.height;
    this.cv.width = Math.round(this.w * this.dpr);
    this.cv.height = Math.round(this.h * this.dpr);

    // Fit the frame inside the canvas, preserving the plate-carrée aspect.
    const fw = this.frame.lonTo - this.frame.lonFrom;
    const fh = this.frame.latTo - this.frame.latFrom;
    this.scale = Math.max(this.w / fw, this.h / fh);

    this.seedTracers();
    this.paintBase();
    this.redrawUnits();
  }

  /** Horizontal offset, in CSS pixels, of the frame's left edge. */
  private get offX(): number {
    return (
      (this.scale * (this.frame.lonTo - this.frame.lonFrom) - this.w) / 2 +
      this.panLon * this.scale
    );
  }

  private get offY(): number {
    return (
      (this.scale * (this.frame.latTo - this.frame.latFrom) - this.h) / 2 -
      this.panLat * this.scale
    );
  }

  /** Chart x for a longitude, in CSS pixels. */
  private px(lon: number): number {
    const from = cx(this.frame.lonFrom);
    let d = cx(lon) - from;
    if (d < 0) d += 360;
    if (d > 360) d -= 360;
    return d * this.scale - this.offX;
  }

  private py(lat: number): number {
    return (cy(lat) - cy(this.frame.latTo)) * this.scale - this.offY;
  }

  /** Inverse: CSS pixel position back to lon/lat. */
  toLonLat(clientX: number, clientY: number): [number, number] {
    const r = this.cv.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const lon = wrapLon((x + this.offX) / this.scale + this.frame.lonFrom);
    const lat = this.frame.latTo - (y + this.offY) / this.scale;
    return [lon, Math.max(-85, Math.min(85, lat))];
  }

  /**
   * Drag the view. A 2.5:1 world map cannot fill a phone screen without either
   * letterboxing or cropping, so we crop and let the reader move.
   */
  panBy(dxPx: number, dyPx: number): void {
    const fw = this.frame.lonTo - this.frame.lonFrom;
    const fh = this.frame.latTo - this.frame.latFrom;
    const slackX = Math.max(0, (fw * this.scale - this.w) / 2 / this.scale);
    const slackY = Math.max(0, (fh * this.scale - this.h) / 2 / this.scale);
    this.panLon = Math.max(-slackX, Math.min(slackX, this.panLon - dxPx / this.scale));
    this.panLat = Math.max(-slackY, Math.min(slackY, this.panLat + dyPx / this.scale));
    this.paintBase();
    this.redrawUnits();
  }

  /** True when there is anything to pan to. */
  get pannable(): boolean {
    const fw = this.frame.lonTo - this.frame.lonFrom;
    const fh = this.frame.latTo - this.frame.latFrom;
    return fw * this.scale - this.w > 4 || fh * this.scale - this.h > 4;
  }

  /* --- palette ---------------------------------------------------------- */

  private readColors(): void {
    this.colors = {
      sea: token('--sea', '#dde8e7'),
      land: token('--paper-3', '#e2d9c4'),
      coast:
        document.documentElement.dataset.theme === 'night'
          ? 'rgba(86,200,220,.30)'
          : 'rgba(12,38,52,.34)',
      tracer: token('--track', '#14647f'),
      unit: token('--signal', '#bd4324'),
      unit2: token('--st-recovered', '#2c6a55'),
      beached: token('--st-grounded', '#9a6a15'),
    };
  }

  private tintOf(u: Unit): string {
    return u.tint === 0 ? this.colors.unit : this.colors.unit2;
  }

  /* --- field cache ------------------------------------------------------ */

  private buildGrid(): void {
    const step = this.gridStep;
    this.gw = Math.round(360 / step) + 1;
    this.gh = Math.round(180 / step) + 1;
    if (!this.grid || this.grid.length !== this.gw * this.gh * 2) {
      this.grid = new Float32Array(this.gw * this.gh * 2);
    }
    const out: Flow = { u: 0, v: 0 };
    let i = 0;
    for (let r = 0; r < this.gh; r++) {
      const lat = 90 - r * step;
      for (let c = 0; c < this.gw; c++) {
        const lon = -180 + c * step;
        currentAt(lon, lat, this.days, out);
        this.grid[i++] = out.u;
        this.grid[i++] = out.v;
      }
    }
    this.gridDay = this.days;
  }

  private sampleGrid(lon: number, lat: number, out: Flow): void {
    if (!this.grid) {
      currentAt(lon, lat, this.days, out);
      return;
    }
    const step = this.gridStep;
    const fx = (wrapLon(lon) + 180) / step;
    const fy = (90 - lat) / step;
    const x0 = Math.floor(fx);
    const y0 = Math.max(0, Math.min(this.gh - 2, Math.floor(fy)));
    const tx = fx - x0;
    const ty = fy - y0;
    const xa = ((x0 % (this.gw - 1)) + (this.gw - 1)) % (this.gw - 1);
    const xb = (xa + 1) % (this.gw - 1);

    const i00 = (y0 * this.gw + xa) * 2;
    const i10 = (y0 * this.gw + xb) * 2;
    const i01 = ((y0 + 1) * this.gw + xa) * 2;
    const i11 = ((y0 + 1) * this.gw + xb) * 2;
    const g = this.grid;

    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;

    out.u = g[i00] * w00 + g[i10] * w10 + g[i01] * w01 + g[i11] * w11;
    out.v = g[i00 + 1] * w00 + g[i10 + 1] * w10 + g[i01 + 1] * w01 + g[i11 + 1] * w11;
  }

  /* --- tracers ---------------------------------------------------------- */

  private seedTracers(): void {
    const area = (this.w * this.h) / (1600 * 700);
    const n = Math.round(
      Math.max(400, Math.min(this.density, this.density * area)) * (this.reduced ? 0.35 : 1),
    );
    const rand = rng(20240110);
    this.tracers = [];
    let guard = 0;
    while (this.tracers.length < n && guard < n * 40) {
      guard++;
      const lon = this.frame.lonFrom + rand() * (this.frame.lonTo - this.frame.lonFrom);
      const lat = this.frame.latFrom + rand() * (this.frame.latTo - this.frame.latFrom);
      if (isLand(lon, lat)) continue;
      this.tracers.push({ lon: wrapLon(lon), lat, life: 40 + Math.floor(rand() * 260) });
    }
  }

  private respawn(t: Tracer): void {
    for (let i = 0; i < 30; i++) {
      const lon = this.frame.lonFrom + Math.random() * (this.frame.lonTo - this.frame.lonFrom);
      const lat = this.frame.latFrom + Math.random() * (this.frame.latTo - this.frame.latFrom);
      if (isLand(lon, lat)) continue;
      t.lon = wrapLon(lon);
      t.lat = lat;
      t.life = 60 + Math.floor(Math.random() * 260);
      return;
    }
    t.life = 60;
  }

  /* --- painting --------------------------------------------------------- */

  /** Full repaint of the static layer: sea, land, coast. */
  private paintBase(): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.colors.sea;
    ctx.fillRect(0, 0, this.w, this.h);
    this.paintLand();
  }

  private paintLand(): void {
    const { ctx } = this;
    const offX = this.offX;
    const offY = this.offY;

    // Chart units -> CSS px -> device px, drawn twice so the seam is covered.
    for (const shift of [0, -360, 360]) {
      const tx = (-cx(this.frame.lonFrom) - shift) * this.scale - offX;
      const ty = -cy(this.frame.latTo) * this.scale - offY;
      if (tx > this.w || tx + 360 * this.scale < 0) continue;
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.translate(tx, ty);
      ctx.scale(this.scale, this.scale);
      ctx.fillStyle = this.colors.land;
      ctx.fill(this.land, 'evenodd');
      ctx.strokeStyle = this.colors.coast;
      ctx.lineWidth = 0.9 / this.scale;
      ctx.lineJoin = 'round';
      ctx.stroke(this.land);
      ctx.restore();
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private redrawUnits(): void {
    if (!this.units.length) return;
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    for (const u of this.units) {
      ctx.strokeStyle = u.beached ? this.colors.beached : this.tintOf(u);
      ctx.globalAlpha = u.beached ? 0.5 : 0.72;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < u.trail.length; i += 2) {
        const x = this.px(u.trail[i]);
        const y = this.py(u.trail[i + 1]);
        if (!started || (i >= 2 && Math.abs(u.trail[i] - u.trail[i - 2]) > 180)) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* --- stepping --------------------------------------------------------- */

  private stepTracers(steps: number): void {
    const { ctx } = this;
    const out: Flow = { u: 0, v: 0 };
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineWidth = 0.85;
    ctx.lineCap = 'round';
    ctx.strokeStyle = this.colors.tracer;
    ctx.globalAlpha = 0.42;
    ctx.beginPath();

    const dt = STEP_DAYS * steps;
    for (const t of this.tracers) {
      const x0 = this.px(t.lon);
      const y0 = this.py(t.lat);
      this.sampleGrid(t.lon, t.lat, out);
      const nl = wrapLon(t.lon + out.u * dt);
      const na = t.lat + out.v * dt;

      t.life--;
      if (t.life <= 0 || na > 87 || na < -87 || isLand(nl, na)) {
        this.respawn(t);
        continue;
      }
      t.lon = nl;
      t.lat = na;

      const x1 = this.px(nl);
      const y1 = this.py(na);
      if (Math.abs(x1 - x0) > this.w * 0.5) continue;
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private stepUnits(steps: number): void {
    if (!this.units.length) return;
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineWidth = 1.35;
    ctx.lineCap = 'round';

    for (let s = 0; s < steps; s++) {
      for (const u of this.units) {
        if (u.beached) continue;
        const x0 = this.px(u.lon);
        const y0 = this.py(u.lat);

        const f = driftAt(u.lon, u.lat, u.windage, this.days);
        let du = f.u * STEP_DAYS + (Math.random() - 0.5) * 0.02 * STEP_DAYS;
        let dv = f.v * STEP_DAYS + (Math.random() - 0.5) * 0.02 * STEP_DAYS;

        let moved = false;
        for (const turn of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
          const cs = Math.cos(turn);
          const sn = Math.sin(turn);
          const nl = wrapLon(u.lon + (du * cs - dv * sn));
          const na = Math.max(-88, Math.min(88, u.lat + (du * sn + dv * cs)));
          if (isLand(nl, na)) continue;
          u.km += haversine(u.lon, u.lat, nl, na);
          u.lon = nl;
          u.lat = na;
          moved = true;
          break;
        }
        if (!moved) {
          u.beached = true;
        }

        const x1 = this.px(u.lon);
        const y1 = this.py(u.lat);
        if (Math.abs(x1 - x0) < this.w * 0.5) {
          ctx.strokeStyle = u.beached ? this.colors.beached : this.tintOf(u);
          ctx.globalAlpha = u.beached ? 0.5 : 0.72;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
        if (u.trail.length < 2400) {
          u.trail.push(u.lon, u.lat);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private paintHeads(): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const u of this.units) {
      if (u.beached) continue;
      ctx.fillStyle = this.tintOf(u);
      ctx.beginPath();
      ctx.arc(this.px(u.lon), this.py(u.lat), 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* --- loop ------------------------------------------------------------- */

  private tick = (t: number): void => {
    if (!this.running) return;
    if (!this.visible) {
      this.raf = requestAnimationFrame(this.tick);
      return;
    }

    const dtReal = Math.min(0.1, (t - this.lastT) / 1000 || 0.016);
    this.lastT = t;

    const steps = Math.max(1, Math.min(14, Math.round((this.speed * dtReal) / STEP_DAYS)));
    this.days += steps * STEP_DAYS;

    if (Math.abs(this.days - this.gridDay) > 45) this.buildGrid();

    // Fade the previous frame instead of clearing, which is what leaves trails.
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = this.mode === 'sim' ? 0.055 : 0.075;
    ctx.fillStyle = this.colors.sea;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalAlpha = 1;

    this.stepTracers(steps);
    this.paintLand();
    this.stepUnits(steps);
    this.paintHeads();

    if (this.mode === 'sim') {
      this.emit();
      if (this.days >= HORIZON_DAYS) {
        this.pause();
        this.emit();
      }
    }

    this.raf = requestAnimationFrame(this.tick);
  };

  /* --- public ----------------------------------------------------------- */

  start(): void {
    if (this.running) return;
    if (!this.grid) this.buildGrid();
    this.running = true;
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    this.emit();
  }

  pause(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.emit();
  }

  toggle(): void {
    if (this.running) this.pause();
    else this.start();
  }

  get isRunning(): boolean {
    return this.running;
  }

  setSpeed(daysPerSecond: number): void {
    this.speed = daysPerSecond;
  }

  /**
   * Run the field forward without drawing, so the hero has established trails
   * the instant it appears rather than a blank sea that slowly fills in.
   */
  warm(steps: number): void {
    if (!this.grid) this.buildGrid();
    const out: Flow = { u: 0, v: 0 };
    for (let s = 0; s < steps; s++) {
      for (const t of this.tracers) {
        this.sampleGrid(t.lon, t.lat, out);
        const nl = wrapLon(t.lon + out.u * STEP_DAYS);
        const na = t.lat + out.v * STEP_DAYS;
        if (--t.life <= 0 || na > 87 || na < -87 || isLand(nl, na)) {
          this.respawn(t);
          continue;
        }
        t.lon = nl;
        t.lat = na;
      }
    }
  }

  /** Release `count` units of a given windage at a position. */
  release(
    lon: number,
    lat: number,
    windage: number,
    count = 120,
    tint = 0,
    label = '',
  ): boolean {
    if (isLand(lon, lat)) return false;
    for (let i = 0; i < count; i++) {
      const jx = (Math.random() - 0.5) * 1.2;
      const jy = (Math.random() - 0.5) * 0.8;
      const l = wrapLon(lon + jx / Math.max(Math.cos(lat * RAD), 0.25));
      const a = Math.max(-85, Math.min(85, lat + jy));
      if (isLand(l, a)) continue;
      this.units.push({
        lon: l,
        lat: a,
        lon0: l,
        lat0: a,
        km: 0,
        beached: false,
        trail: [l, a],
        windage,
        tint,
        label,
      });
    }
    this.emit();
    return true;
  }

  clear(): void {
    this.units = [];
    this.days = 0;
    this.paintBase();
    this.emit();
  }

  state(): SimState {
    const afloat = this.units.filter((u) => !u.beached);
    const dists = afloat
      .map((u) => haversine(u.lon0, u.lat0, u.lon, u.lat))
      .sort((a, b) => a - b);

    const counts = new Map<string, { n: number; short: string }>();
    for (const u of afloat) {
      const g = gyreAt(u.lon, u.lat, this.days);
      if (!g) continue;
      const e = counts.get(g.id) ?? { n: 0, short: g.short };
      e.n++;
      counts.set(g.id, e);
    }
    let gyre: string | null = null;
    let gyreName: string | null = null;
    let best = 0;
    for (const [id, e] of counts) {
      if (e.n > best) {
        best = e.n;
        gyre = id;
        gyreName = e.short;
      }
    }
    // Only claim a gyre when it actually holds a meaningful share of the field.
    if (best < Math.max(3, afloat.length * 0.25)) {
      gyre = null;
      gyreName = null;
    }

    return {
      days: Math.round(this.days),
      released: this.units.length,
      afloat: afloat.length,
      beached: this.units.length - afloat.length,
      spreadKm: dists.length ? Math.round(dists[Math.floor(dists.length / 2)]) : 0,
      gyre,
      gyreName,
      furthestKm: this.units.reduce((a, u) => Math.max(a, u.km), 0),
      running: this.running,
      done: this.days >= HORIZON_DAYS,
      groups: this.groupStates(),
    };
  }

  private groupStates(): GroupState[] {
    const by = new Map<number, Unit[]>();
    for (const u of this.units) {
      const arr = by.get(u.tint);
      if (arr) arr.push(u);
      else by.set(u.tint, [u]);
    }
    return [...by.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tint, us]) => {
        const up = us.filter((u) => !u.beached);
        const d = up.map((u) => haversine(u.lon0, u.lat0, u.lon, u.lat)).sort((a, b) => a - b);
        return {
          tint,
          label: us[0].label,
          windage: us[0].windage,
          released: us.length,
          afloat: up.length,
          spreadKm: d.length ? Math.round(d[Math.floor(d.length / 2)]) : 0,
          furthestKm: Math.round(us.reduce((a, u) => Math.max(a, u.km), 0)),
        };
      });
  }

  private emit(): void {
    this.onState?.(this.state());
  }
}

export { HORIZON_DAYS };
