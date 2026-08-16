# THE DRIFT REGISTRY

### Office of Pelagic Recovery — Ilwaco, Washington — est. 1974

> *Nothing is lost. It is only in transit.*

A fictional hydrographic archive that keeps case files on objects lost at sea,
and computes where each one is **today** using a surface-current model of the
world ocean.

---

## The concept

Most archives hold objects. This one holds positions, and the objects are
elsewhere — still moving.

The Drift Registry is presented as a small working institute that has, since
1974, maintained sixteen open files on things that went into the water and never
stopped: sixty-one thousand shoes off a container ship, twenty-eight thousand
eight hundred bath toys, five million pieces of moulded plastic, a concrete dock,
a child's toy boat. Each file is written like a missing-persons record rather
than an inventory line. It carries a release position, a sighting log, a
**status** — `IN TRANSIT`, `GROUNDED`, `RECOVERED`, `DISPERSED`, `DORMANT`,
`LOST TO RECORD` — and a modelled present position.

The argument the site is making is that the ocean does not destroy things, it
circulates them. A full circuit of the North Pacific Subtropical Gyre takes about
three years. That is a clock made of water, and anything caught in it is a hand
on the dial.

Three real things sit underneath the fiction:

1. **Beachcombing became oceanography.** The 1990 Nike spill and the 1992 bath
   toy spill were genuinely used to calibrate surface-drift models. Junk on a
   beach is calibration data.
2. **Windage decides everything.** A shoe rides low and goes where the water
   goes. A hollow toy rides high and gets pushed by wind. Two objects lost in the
   same wave finish on different continents.
3. **Gyres are slow, and therefore legible.** You can read arrival dates
   backwards into a map of the current, which is exactly what happened.

### It is honest about being fiction

The Office of Pelagic Recovery does not exist. Every page carries a disclosure in
the footer and `/about#disclosure` states it plainly. Each case file is marked:

| Mark | Meaning | Files |
|---|---|---|
| `documented` | Built around a real, publicly recorded loss event | 8 |
| `reconstructed` | Assembled from partial records; positions inferred | 3 |
| `speculative` | Invented for this Registry | 5 |

The oceanography is not fiction. The institution is.

---

## The engine

One module — [`src/lib/ocean.ts`](src/lib/ocean.ts) — is the entire physical
argument of the site, and it runs in **two places**:

- in **Node at build time**, to solve every case file's trajectory;
- in the **browser at runtime**, to power the Drift Simulator.

They agree because they are the same code. That is the whole trick.

**What's in the model**

- 7 closed circulations (5 subtropical gyres, 2 subpolar)
- 23 boundary currents and their continuations — Gulf Stream, Kuroshio, Agulhas, Oyashio, Labrador,
  Malvinas, the Norwegian Coastal Current, the European shelf-edge current…
- 4 zonal bands — Antarctic Circumpolar, N/S Equatorial, Equatorial Counter
- Ekman convergence toward each gyre core (this is what builds garbage patches)
- A westward-propagating eddy field — **not decoration**: a steady field has
  fixed points at the gyre centres, and anything reaching one parks there forever
- Seasonal migration of the wind belts and convergence zones
- A wind field acting on objects in proportion to their **windage** (0.04 for a
  drift bottle, 0.34 for a drift card)
- Land collision against a real 0.5° land mask, with coast-sliding, stranding
  probability and refloat

**Calibration.** Mean surface speed over the ocean comes out at ~0.15 m/s and the
Gulf Stream core at ~1.7 m/s, which are the right numbers. Measured circuit times
— by dropping a tracer on each gyre's northern arm and timing its return — are
3.2 yr for the North Pacific and 2.1 yr for the North Atlantic. The figures
printed on `/gyres` are those measurements, not literature values.

**Ensembles, not trajectories.** Each file is solved 24 times from a release box
a few tens of kilometres across. The chart draws all 24. The heavy line is the
member most consistent with the sighting log; the faint ones are the other
solutions.

**The model is scored in public.** Every reported find is compared against the
ensemble and the miss distance is printed on the case file. The median residual
across the registry is about **290 km**; the worst is over 6,000 km, and that one
is shown in red. Where the ensemble contradicts the status written on a file, the
page prints a **model dissent** notice rather than quietly editing the record.
Five of sixteen files carry one.

---

## Technology

| | |
|---|---|
| **Framework** | Astro 5, fully static output |
| **UI framework** | None. No React, no client router, no CSS framework |
| **Interactivity** | Hand-written TypeScript modules, loaded per page |
| **Rendering** | Inline SVG for charts, Canvas 2D for the live drift field |
| **Styling** | Plain CSS with custom properties; two first-class themes |
| **Geodata** | Natural Earth via `world-atlas` (public domain), processed at build time |
| **Fonts** | Newsreader, Public Sans, IBM Plex Mono — self-hosted via Fontsource |
| **Images** | None. Every mark on the site is drawn from data or from type |
| **Runtime deps** | Zero. No fetch, no CDN, no analytics, no tracking |

### Build pipeline

Two scripts run before Astro and generate everything the site knows about
geography and drift:

```
scripts/build-geo.mjs      Natural Earth TopoJSON
                             → 3 coastline SVG paths (1:110m, generalised 1:50m, 1:50m)
                             → a 720×360-bit land mask, base64, via scanline rasteriser
                             (land coverage checks out at 29.0%, against a true 29.2%)

scripts/build-tracks.mjs   16 case files × 24 ensemble members
                             → trajectories, present positions, distances
                             → per-sighting model residuals
                             → model-implied status and dissent flags
```

Both are pure Node and import the TypeScript model directly using Node 24's
native type stripping. There is no separate compile step for them.

---

## Project structure

```
├── docs/
│   └── CONCEPT.md                 The design brief, written before the build
├── scripts/
│   ├── build-geo.mjs              Coastlines + land mask from Natural Earth
│   ├── build-tracks.mjs           Solves the registry against the model
│   └── shots.mjs                  Visual + interaction smoke test (Playwright)
├── src/
│   ├── lib/
│   │   ├── ocean.ts               ★ The drift model. Node + browser.
│   │   ├── chart.ts               Plate-carrée projection, framing, graticules
│   │   └── registry.ts            Taxonomy: statuses, classes, formatting
│   ├── data/
│   │   ├── cases.ts               ★ The sixteen case files
│   │   └── generated/             Build output — never edited by hand
│   │       ├── coast-detail.ts    1:50m coastline (canvas)
│   │       ├── coast-mid.ts       generalised 1:50m (regional charts)
│   │       ├── coast-simple.ts    1:110m (world charts)
│   │       ├── landmask.ts        0.5° land bitmask
│   │       └── tracks.ts          Solved trajectories + residuals
│   ├── islands/
│   │   └── drift-canvas.ts        ★ The live flow field and simulator engine
│   ├── components/                Chart, CaseCard, Masthead, Foot
│   ├── layouts/Base.astro
│   ├── pages/
│   │   ├── index.astro            Front page
│   │   ├── registry/index.astro   Catalogue, filterable
│   │   ├── registry/[code].astro  Case file (×16, generated)
│   │   ├── drift.astro            Drift Simulator
│   │   ├── gyres.astro            The seven circulations
│   │   ├── report.astro           Report a find
│   │   ├── about.astro            History, method, disclosure, colophon
│   │   └── 404.astro
│   └── styles/base.css            The design system
└── public/                        favicon, robots.txt
```

---

## Pages and features

**`/` — Front page.** A live, Pacific-centred flow field runs behind the
masthead: several thousand tracers advected through the real current model. Below
it, a world chart plots the modelled present position of all sixteen files.

**`/registry` — The catalogue.** Search across names, codes, materials, vessels
and place names; filter by status, class and basin; sort by release date,
registry code, distance travelled or model agreement. Filter state is written to
the URL, so any view is shareable. Includes a written empty state.

**`/registry/[code]` — The case file.** The deepest page in the archive:

- a regional plate showing all 24 ensemble members, the representative solution,
  the forward projection, the release point, every reported find and the present
  position — with the track drawing itself in on first view
- a **time scrubber** that walks the modelled position from release to today,
  reporting date, elapsed years, position and distance travelled
- a sighting log with a **model residual** for every entry, colour-graded
- a **model dissent** notice where the ensemble contradicts the filed status
- dated field notes, particulars, and prev/next navigation
- hovering a log row highlights its pin on the chart, and vice versa

**`/drift` — The Drift Simulator.** Click any water in the world to release an
object and watch twenty years of drift. Choose from seven windage profiles; set
release size and playback rate; pause, clear, keyboard shortcuts. Drag to move
the chart — a 2.5:1 world map cannot fill a phone screen without either
letterboxing or cropping, so it crops and lets you move. A live readout reports
elapsed years, how many units are still afloat, the median spread, the furthest
single unit, and which gyre currently holds the population.

The best thing on it is **Matched pair**: release your chosen object *and* a
drift bottle at the same point, and watch them separate. Same wave, same water —
the only difference is how much of each stands above the surface. That is the
whole thesis of the site, made interactive.

**`/gyres` — The seven circulations.** An annotated world chart with the gyres
drawn as marching dashed ellipses spinning the correct way for their hemisphere,
boundary currents weighted by speed, and labels. Hovering a row below isolates
that circulation on the chart. Each gyre lists the case files it currently holds.

**`/report` — Report a find.** A shore-report form with real client-side
validation (including rejecting future dates), a live character counter, and a
receipt with a deterministic reference number. It transmits nothing, and says so.

**`/about` — The Office.** Origin, a six-step account of the method, the
controlled vocabulary, the full disclosure, and a colophon.

---

## Design

**Reference: a printed hydrographic chart.** Not "an ocean website" — no stock
photography, no tropical gradients. Warm paper, ink-blue linework, dense
marginalia, monospaced soundings, one loud colour used sparingly.

- **Chart** (light) — paper `#f2ede1`, chart ink `#0c2634`, buoy orange `#bd4324`
- **Night watch** (dark) — abyssal `#060c12`, luminous cyan `#56c8dc`, same orange

Both themes are first-class, including the canvas, which re-reads its palette
when you switch. The choice persists, and the theme is applied before first paint
so the page never flashes.

**Type.** *Newsreader* for display (editorial, quiet authority), *Public Sans* for
interface — the US federal design system face, which is exactly right for an
institute that does not exist — and *IBM Plex Mono* for registry codes,
coordinates and soundings. Tabular figures everywhere numbers are compared.

**Motion is slow by policy.** Nothing bounces. Tracks draw themselves. The only
thing that blinks on the entire site is the status dot on a file that is still at
sea. Everything honours `prefers-reduced-motion`, including the drift field,
which cuts its tracer count and stops animating in.

---

## Accessibility

- Semantic landmarks, one `h1` per page, correct heading order
- Skip link, visible focus rings on a 2px offset
- Every control is labelled; the registry result count is a live region
- Form errors are announced via `aria-invalid` and described text, not colour
- Charts carry `role="img"` and descriptive labels; every pin has a `<title>`
- Status is never colour alone — the pill always carries its word
- Reveal-on-scroll is gated behind a `js` class and backed by a timeout, so no
  content can ever be permanently hidden by a failed script
- Full keyboard operation, including the simulator (space, `c`)

Verified across three viewports and both themes: no console errors, no failed
requests, no horizontal overflow, no dead internal links.

---

## Performance

- Fully static. No client framework, no hydration, no runtime data fetching.
- Per-page JS is under 4 KB except the two pages that share the canvas engine.
- Coastlines ship at three levels of detail so a whole-world chart doesn't pay
  for coastline it can't resolve.
- The simulator uses a cached 2° field lookup for the thousands of decorative
  tracers, and the **exact** model for the objects you release — the ones whose
  numbers are reported.
- Canvas work pauses when scrolled out of view.

| | raw | gzipped |
|---|---|---|
| Front page | 64 KB | 20 KB |
| Registry index | 42 KB | 9 KB |
| Case file (heaviest) | 155 KB | 51 KB |
| Simulator page | 18 KB | 5 KB |
| Drift engine (cached, shared) | 167 KB | 56 KB |
| Full stylesheet | 21 KB | 5 KB |

---

## Running it

```bash
npm install
npm run dev        # http://localhost:4321
```

`predev` and `prebuild` run the geo and track generators automatically, so a
clean checkout works with nothing else.

```bash
npm run build      # static site → dist/
npm run preview    # serve dist/
npm run check      # astro check — 0 errors, 0 warnings
```

Regenerate the data layer on its own:

```bash
npm run geo        # coastlines + land mask
npm run tracks     # re-solve all sixteen files (prints a report)
```

`npm run tracks` prints one line per file — ensemble survival, spread, present
position, mean rate, holding gyre, median residual, and any model dissent. It is
the fastest way to see what changing the physics does to the archive.

Run the visual and interaction test suite against a running preview:

```bash
npm run preview                                    # in one terminal
node scripts/shots.mjs http://localhost:4321 shots # in another
```

It drives a real Chromium across three viewports and both themes, checks for
console errors, horizontal overflow and dead links, exercises the registry
filters, the case scrubber, the simulator and the report form, and writes
screenshots to `shots/`.

**Note on dates.** Present positions are solved at build time against the build
date, which is stamped on every page as the *solution of record*. Trajectories
are integrated eight years past it, so the archive stays coherent for a long
while — and rebuilding advances every object in it.

---

## Sources

Natural Earth (public domain) via `world-atlas`. Curtis Ebbesmeyer and Eric
Scigliano, *Flotsametrics and the Floating World*. The OSCURS surface-current
model. Tracey Williams's long record of the Tokio Express Lego on Cornish
beaches. Published work on the North Pacific Subtropical Convergence Zone.

The Office of Pelagic Recovery is not among them.
