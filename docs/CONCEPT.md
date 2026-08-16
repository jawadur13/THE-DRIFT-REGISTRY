# THE DRIFT REGISTRY
### Office of Pelagic Recovery — Ilwaco, Washington — est. 1974

> *"Nothing is lost. It is only in transit."*

## The idea

A registry for objects that fell into the ocean and never stopped moving.

The Drift Registry is a **fictional hydrographic institute** presented as a real
working archive. It keeps case files on things lost at sea — containerised cargo,
drift bottles, deck gear, single personal objects — and models where each of them
is *right now*, decades later, using a surface-current model of the world ocean.

Every case file is written like a missing-persons record rather than an inventory
line. Objects have a release position, a last confirmed sighting, a projected
present-day position, and a **status**: IN TRANSIT, GROUNDED, DISPERSED, DORMANT,
RECOVERED, or LOST TO RECORD.

The emotional argument of the site: the ocean does not destroy things, it
circulates them. A rubber duck released in a storm in 1992 is not gone. It is
somewhere, on a schedule, and the schedule is knowable.

## Why it deserves to exist

Three real things collide here:

1. **Beachcombing became oceanography.** The 1990 Nike spill and the 1992
   bath-toy spill were used by Curtis Ebbesmeyer and James Ingraham to calibrate
   the OSCURS surface-current model. Junk on a beach is calibration data.
2. **Windage matters.** A shoe rides low and goes where the water goes. A hollow
   toy rides high and gets pushed by wind. Two objects released in the same wave
   land on different continents. The site makes you feel that.
3. **Gyres are slow.** A full circuit of the North Pacific Subtropical Gyre is
   roughly three years. That's a clock made of water.

## The site is honest about being fiction

The Office of Pelagic Recovery does not exist. Case files marked **DOCUMENTED**
are built around real, publicly recorded loss events; files marked
**RECONSTRUCTED** or **SPECULATIVE** are invented. Every page carries a
disclosure in the footer, and `/about` states it plainly. Nothing here should be
mistaken for an official record.

## Audience

People who like: deep-time, maps, archives, quiet institutional design, the
Long Now, obsessive taxonomies, and the specific pleasure of a well-made
interactive thing. Not a product — a place.

## Design direction

**Nautical chart, not "ocean website".** No stock photos of waves. No gradients
of tropical blue. The reference is a printed hydrographic chart: warm paper,
ink-blue linework, depth stipple, dense marginalia, tide tables, monospaced
soundings.

- **Light theme — "Chart"**: warm paper `#F2EDE1`, chart ink `#0C2634`,
  shallow-water tint, buoy orange `#D8552B` for signal.
- **Dark theme — "Night Watch"**: abyssal `#050B12`, luminous cyan `#57C7D4`
  for tracks, same buoy orange.
- **Type**: *Newsreader* (editorial serif, display), *Public Sans* (the US
  federal design system face — institutional UI), *IBM Plex Mono* (soundings,
  registry codes, coordinates).
- **Motion**: slow, tidal. Nothing bounces. Tracks draw. Numbers count. Full
  `prefers-reduced-motion` compliance.

## The engine

One surface-current model, `src/lib/ocean.ts`, used in two places:

- At **build time** (Node) to compute every case file's modelled trajectory.
- At **runtime** (browser) to power the live Drift Simulator.

The registry and the simulator therefore agree with each other, which is the
whole trick.

Model components: five subtropical gyres + two subpolar gyres, the Antarctic
Circumpolar Current, north/south equatorial currents, an equatorial
countercurrent, western-boundary intensification (Kuroshio / Gulf Stream /
Agulhas), Ekman convergence toward gyre cores, curl noise, and a wind field
that acts on objects in proportion to their **windage**. Land collision uses a
1/3° land mask rasterised from Natural Earth at build time.

## Pages

| Route | Purpose |
|---|---|
| `/` | The institute, live drift field, featured cases, the clock made of water |
| `/registry` | Full catalogue — search, filter by class/status/ocean, sort |
| `/registry/[code]` | Case file: chart, trajectory, sighting log, field notes |
| `/drift` | Drift Simulator — release an object anywhere, watch 20 years |
| `/gyres` | The seven circulations, explained on an interactive chart |
| `/report` | Report a find — the form that feeds the registry |
| `/about` | History, method, disclosure, colophon |
