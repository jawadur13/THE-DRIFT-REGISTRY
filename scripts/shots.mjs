/**
 * shots.mjs — visual and functional smoke test.
 *
 * Drives the built site in a real Chromium, captures screenshots at three
 * widths in both themes, and fails loudly on any console error, page error,
 * failed request, or horizontal overflow.
 *
 *   node scripts/shots.mjs [baseUrl] [outDir]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4321';
const OUT = process.argv[3] ?? 'shots';

const PAGES = [
  ['home', '/'],
  ['registry', '/registry'],
  ['case-floatees', '/registry/DR-1992-0031'],
  ['case-ossian', '/registry/DR-1959-0002'],
  ['drift', '/drift'],
  ['gyres', '/gyres'],
  ['report', '/report'],
  ['about', '/about'],
  ['notfound', '/nope'],
];

const VIEWPORTS = [
  ['desktop', 1440, 900],
  ['tablet', 834, 1100],
  ['mobile', 390, 844],
];

mkdirSync(OUT, { recursive: true });

const exe =
  process.env.CHROME ??
  'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: exe, headless: true });
const problems = [];

for (const [vpName, w, h] of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: vpName === 'desktop' ? 1.5 : 2,
    reducedMotion: 'no-preference',
  });

  for (const [name, path] of PAGES) {
    const page = await ctx.newPage();
    const errs = [];

    page.on('console', (m) => {
      // A 404 page is meant to 404; the browser logs that as a console error.
      if (m.type() === 'error' && !(path === '/nope' && m.text().includes('404'))) {
        errs.push(`console: ${m.text()}`);
      }
    });
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => {
      const f = r.failure();
      errs.push(`request failed: ${r.url()} — ${f ? f.errorText : '?'}`);
    });

    const res = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 30000 });
    const status = res ? res.status() : 0;
    const expected = path === '/nope' ? 404 : 200;
    if (status !== expected) problems.push(`${vpName} ${path}: status ${status}`);

    // Let the page's own scripts register first, then walk the page so
    // reveal-on-scroll has fired before anything is captured.
    await page.waitForTimeout(600);
    await page.evaluate(async () => {
      const step = Math.round(window.innerHeight * 0.8);
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 40));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1600);

    // Horizontal overflow check.
    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      const over = d.scrollWidth - d.clientWidth;
      if (over <= 1) return null;
      const bad = [];
      for (const el of document.querySelectorAll('body *')) {
        // SVG children report geometric bounds, not the clipped viewport, so
        // they produce false positives here.
        if (el.ownerSVGElement) continue;
        const r = el.getBoundingClientRect();
        if (r.right > d.clientWidth + 2 && r.width > 8) {
          bad.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} → ${Math.round(r.right)}`);
          if (bad.length > 4) break;
        }
      }
      return { over, bad };
    });
    if (overflow) {
      problems.push(`${vpName} ${path}: overflows by ${overflow.over}px — ${overflow.bad.join(', ')}`);
    }

    // Every internal link must resolve to a page we actually build.
    const links = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => h && h.startsWith('/')),
    );
    for (const l of new Set(links)) {
      const known =
        l === '/' ||
        /^\/(registry|drift|gyres|report|about)(\/|#|$)/.test(l) ||
        l.startsWith('/#');
      if (!known) problems.push(`${vpName} ${path}: unknown internal link ${l}`);
    }

    await page.screenshot({
      path: `${OUT}/${vpName}-${name}.png`,
      fullPage: vpName === 'desktop' && name !== 'drift',
    });

    // Dark theme, desktop only.
    if (vpName === 'desktop') {
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'night';
        window.dispatchEvent(new CustomEvent('dr:theme'));
      });
      await page.waitForTimeout(900);
      await page.screenshot({
        path: `${OUT}/night-${name}.png`,
        fullPage: name !== 'drift',
      });
    }

    if (errs.length) problems.push(`${vpName} ${path}:\n    ${errs.join('\n    ')}`);
    await page.close();
  }

  await ctx.close();
}

/* --- interaction tests --------------------------------------------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(`console: ${m.text()}`);
  });

  // Registry filtering.
  await page.goto(`${BASE}/registry`, { waitUntil: 'networkidle' });
  await page.fill('#f-q', 'cornwall');
  await page.waitForTimeout(300);
  let shown = await page.locator('#reg-list > li:visible').count();
  if (shown < 1) problems.push(`registry: search "cornwall" returned ${shown} results`);

  await page.fill('#f-q', 'zzzzzz');
  await page.waitForTimeout(300);
  const emptyVisible = await page.locator('#reg-empty').isVisible();
  if (!emptyVisible) problems.push('registry: empty state did not appear');
  if (await page.locator('#reg-list').isVisible()) {
    problems.push('registry: list still visible with zero results');
  }
  await page.screenshot({ path: `${OUT}/x-registry-empty.png` });

  await page.click('#f-reset-2');
  await page.waitForTimeout(300);
  shown = await page.locator('#reg-list > li:visible').count();
  if (shown !== 16) problems.push(`registry: reset showed ${shown} of 16`);

  await page.selectOption('#f-status', 'recovered');
  await page.waitForTimeout(300);
  shown = await page.locator('#reg-list > li:visible').count();
  if (shown < 1) problems.push(`registry: status filter returned ${shown}`);
  await page.screenshot({ path: `${OUT}/x-registry-filtered.png` });

  // Case scrubber.
  await page.goto(`${BASE}/registry/DR-1992-0031`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const before = await page.locator('#scrub-out').textContent();
  await page.locator('#scrub').fill('12');
  await page.waitForTimeout(200);
  const after = await page.locator('#scrub-out').textContent();
  if (!before || before === after) problems.push(`case: scrubber did not update (${before} → ${after})`);
  await page.screenshot({ path: `${OUT}/x-case-scrub.png`, fullPage: false });

  // Simulator.
  await page.goto(`${BASE}/drift`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  if (await page.locator('#sim-readout').isVisible()) {
    problems.push('drift: readout is visible before anything is released');
  }
  await page.locator('.presets li').first().locator('button').click();
  await page.waitForTimeout(3500);
  const years = await page.locator('#r-years').textContent();
  const afloat = await page.locator('#r-afloat').textContent();
  if (!years || years === '0.0 yr') problems.push(`drift: clock did not advance (${years})`);
  if (!afloat || afloat === '—') problems.push(`drift: no units released (${afloat})`);
  await page.screenshot({ path: `${OUT}/x-drift-running.png` });

  await page.check('#c-pair');
  // The radio itself is visually hidden behind its label, which is what a
  // real click lands on.
  await page.locator('label.kind', { hasText: 'Drift card' }).click();
  await page.locator('.presets li').nth(4).locator('button').click();
  await page.waitForTimeout(3000);
  const cmpVisible = await page.locator('#sim-compare').isVisible();
  if (!cmpVisible) problems.push('drift: matched-pair panel did not appear');
  await page.screenshot({ path: `${OUT}/x-drift-pair.png` });

  // Report form validation and receipt.
  await page.goto(`${BASE}/report`, { waitUntil: 'networkidle' });
  if (await page.locator('#rep-receipt').isVisible()) {
    problems.push('report: receipt is visible before the form is submitted');
  }
  await page.click('button[type=submit]');
  await page.waitForTimeout(300);
  const invalid = await page.locator('[data-field][data-invalid="true"]').count();
  if (invalid < 4) problems.push(`report: expected 4+ invalid fields, got ${invalid}`);
  await page.screenshot({ path: `${OUT}/x-report-invalid.png` });

  await page.fill('#r-what', 'A yellow plastic duck, moulded');
  await page.fill('#r-date', '2026-05-04');
  await page.fill('#r-place', 'Ardnamurchan, north shore');
  await page.fill('#r-lat', '56.72');
  await page.fill('#r-lon', '-6.02');
  await page.fill('#r-name', 'A. Beachcomber');
  await page.fill('#r-email', 'a@example.com');
  await page.click('button[type=submit]');
  await page.waitForTimeout(600);
  const receipt = await page.locator('#rep-receipt').isVisible();
  const ref = await page.locator('#rc-ref').textContent();
  if (!receipt) problems.push('report: receipt did not appear');
  if (!/^OPR-\d{4}-\d{4}$/.test(ref ?? '')) problems.push(`report: bad reference "${ref}"`);
  await page.screenshot({ path: `${OUT}/x-report-receipt.png` });

  // Future date must be rejected.
  await page.click('#rc-again');
  await page.waitForTimeout(400);
  await page.fill('#r-date', '2030-01-01');
  await page.locator('#r-date').blur();
  await page.waitForTimeout(200);
  const futureErr = await page.locator('#r-date').getAttribute('aria-invalid');
  if (futureErr !== 'true') problems.push('report: future date was accepted');

  // Theme toggle persists.
  await page.goto(`${BASE}/about`, { waitUntil: 'networkidle' });
  await page.click('#theme-toggle');
  await page.waitForTimeout(300);
  const t1 = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.goto(`${BASE}/gyres`, { waitUntil: 'networkidle' });
  const t2 = await page.evaluate(() => document.documentElement.dataset.theme);
  if (t1 !== t2) problems.push(`theme: did not persist across navigation (${t1} → ${t2})`);

  if (errs.length) problems.push(`interaction pass:\n    ${errs.join('\n    ')}`);
  await ctx.close();
}

await browser.close();

if (problems.length) {
  console.log(`\n✗ ${problems.length} problem(s):\n`);
  for (const p of problems) console.log('  • ' + p);
  process.exitCode = 1;
} else {
  console.log('\n✓ all pages clean: no console errors, no overflow, no dead links');
}
