/**
 * registry.ts — the vocabulary of the Registry.
 *
 * Types, controlled terms, and the small helper functions that every page uses
 * to talk about a case file. Kept separate from the case data itself so the
 * taxonomy can be reasoned about on its own.
 */

/** How much of a case file is drawn from the public record. */
export type Basis = 'documented' | 'reconstructed' | 'speculative';

export type StatusId =
  | 'in-transit'
  | 'grounded'
  | 'recovered'
  | 'dispersed'
  | 'dormant'
  | 'lost-to-record';

export interface StatusDef {
  id: StatusId;
  label: string;
  /** One line, printed under the status on a case file. */
  gloss: string;
  /** CSS custom-property suffix, e.g. --st-transit. */
  token: string;
}

export const STATUSES: StatusDef[] = [
  {
    id: 'in-transit',
    label: 'In transit',
    gloss: 'Afloat. Position modelled, not observed.',
    token: 'transit',
  },
  {
    id: 'grounded',
    label: 'Grounded',
    gloss: 'Ashore and logged, but not collected.',
    token: 'grounded',
  },
  {
    id: 'recovered',
    label: 'Recovered',
    gloss: 'In hand. Chain of custody closed.',
    token: 'recovered',
  },
  {
    id: 'dispersed',
    label: 'Dispersed',
    gloss: 'No longer a coherent field. Tracked as a probability, not a thing.',
    token: 'dispersed',
  },
  {
    id: 'dormant',
    label: 'Dormant',
    gloss: 'Believed held in a convergence zone. Movement below detection.',
    token: 'dormant',
  },
  {
    id: 'lost-to-record',
    label: 'Lost to record',
    gloss: 'No confirmed contact since first entry. The file stays open.',
    token: 'lost',
  },
];

export const statusById = (id: StatusId): StatusDef =>
  STATUSES.find((s) => s.id === id) ?? STATUSES[0];

export type ClassId = 'I' | 'II' | 'III' | 'IV' | 'V';

export interface ClassDef {
  id: ClassId;
  label: string;
  gloss: string;
}

export const CLASSES: ClassDef[] = [
  {
    id: 'I',
    label: 'Buoyant cargo',
    gloss: 'Manufactured goods lost from a vessel in bulk. Countable at release.',
  },
  {
    id: 'II',
    label: 'Vessel remains',
    gloss: 'Hull, deck gear, floats, instruments. Anything that was part of a working thing.',
  },
  {
    id: 'III',
    label: 'Deliberate release',
    gloss: 'Drift cards, drift bottles, instrumented buoys. Objects sent to be found.',
  },
  {
    id: 'IV',
    label: 'Personal effect',
    gloss: 'A single object with a known owner. The hardest files to close.',
  },
  {
    id: 'V',
    label: 'Composite raft',
    gloss: 'A debris field of mixed origin, moving as a loose population.',
  },
];

export const classById = (id: ClassId): ClassDef =>
  CLASSES.find((c) => c.id === id) ?? CLASSES[0];

export interface Sighting {
  /** ISO date. */
  date: string;
  lat: number;
  lon: number;
  place: string;
  /** Free text; how many were logged. */
  count?: string;
  /** Who logged it. */
  by?: string;
  note?: string;
}

export interface CaseFile {
  /** Registry code, e.g. DR-1992-0031. */
  code: string;
  name: string;
  subtitle: string;
  class: ClassId;
  status: StatusId;
  basis: Basis;
  /** Which drifter profile in ocean.ts governs this object's windage. */
  drifter: string;
  release: {
    date: string;
    lat: number;
    lon: number;
    place: string;
    /** Vessel or agent of release, if known. */
    vessel?: string;
  };
  quantity: string;
  materials: string[];
  /** Basin, for filtering. */
  ocean: 'Pacific' | 'Atlantic' | 'Indian' | 'Southern' | 'Arctic';
  /** Two or three paragraphs. */
  summary: string[];
  /** Dated marginalia from the file. */
  notes: { date: string; text: string }[];
  sightings: Sighting[];
  /** Deterministic seed for the modelled track. */
  seed: number;
  /**
   * Probability that a land contact ends this object's drift. Defaults by class:
   * a single object stops when it comes ashore, a population keeps arriving.
   */
  strand?: number;
  /** Set on the one file the Registry puts on the front page. */
  featured?: boolean;
}

/** Sort helpers used by the registry index. */
export const byCode = (a: CaseFile, b: CaseFile) => a.code.localeCompare(b.code);
export const byReleaseDesc = (a: CaseFile, b: CaseFile) =>
  b.release.date.localeCompare(a.release.date);

/** Format a date as the Registry prints it: 10 JAN 1992. */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!d) return `${MONTHS[(m || 1) - 1]} ${y}`;
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

/** Format a coordinate pair in the Registry's house style. */
export function fmtCoord(lat: number, lon: number): string {
  const la = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
  const lo = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
  return `${la} ${lo}`;
}

/** Whole years and months between two ISO dates. */
export function elapsed(fromIso: string, toIso: string): string {
  const a = new Date(fromIso + 'T00:00:00Z');
  const b = new Date(toIso + 'T00:00:00Z');
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months--;
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y <= 0) return `${m} month${m === 1 ? '' : 's'}`;
  if (m === 0) return `${y} year${y === 1 ? '' : 's'}`;
  return `${y} yr ${m} mo`;
}
