/* Bumblebee Simulator - headless smoke test.
 *
 * Development only. The game itself has no dependencies and never loads this
 * file; it exists so the browser can be checked without a human watching.
 *
 * Run:  node tools/smoke-test.mjs
 *       node tools/smoke-test.mjs --shots        (also write screenshots)
 *
 * It checks the things that actually break a canvas game and are invisible
 * from the source: script load order over file://, console errors, whether the
 * canvas is drawing anything other than a flat colour, and whether the bee
 * responds to keys.
 */

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

/* Playwright is a dev tool, not a dependency of the game, so it may only exist
   as a global install. NODE_PATH does not apply to ES module imports, so
   resolve it through require instead and fall back to the global root. */
const req = createRequire(import.meta.url);
function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_PACKAGE) candidates.push(process.env.PLAYWRIGHT_PACKAGE);
  candidates.push('playwright');
  try {
    candidates.push(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
  } catch { /* npm not on PATH; the other candidates may still work */ }
  candidates.push('/opt/node22/lib/node_modules/playwright');

  const tried = [];
  for (const c of candidates) {
    try {
      return req(c);
    } catch (err) {
      tried.push(c);
    }
  }
  console.error('Could not load playwright. Tried:\n  ' + tried.join('\n  ') +
    '\nInstall it with:  npm i -g playwright');
  process.exit(2);
}
const { chromium, devices } = loadPlaywright();

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const indexUrl = pathToFileURL(join(root, 'index.html')).href;
const shotDir = process.env.SHOT_DIR || join(root, '.smoke-shots');
const wantShots = process.argv.includes('--shots');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok ? '  ok  ' : ' FAIL ';
  console.log(mark + name + (detail ? '  -> ' + detail : ''));
}

/* Count distinct colours in the rendered frame. A game that renders a single
   flat rectangle passes a naive "canvas is not blank" test; this does not. */
const COLOUR_PROBE = `(() => {
  const c = document.getElementById('game');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 97) {
    seen.add((d[i] >> 3) + ',' + (d[i+1] >> 3) + ',' + (d[i+2] >> 3));
  }
  return { colours: seen.size, w: c.width, h: c.height };
})()`;

async function newPage(browser, query = '') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(indexUrl + query, { waitUntil: 'load' });
  return { page, errors };
}

async function main() {
  if (wantShots) mkdirSync(shotDir, { recursive: true });

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader']
  });

  /* ---------------------------------------------------------------- 1 ---- */
  /* The single most important check: does it work from the filesystem?
     If anyone converts these scripts to ES modules, this fails immediately. */
  {
    const { page, errors } = await newPage(browser);
    const ns = await page.evaluate('typeof window.BB === "object" && BB.VERSION');
    check('loads from file:// and exposes BB', !!ns, 'version ' + ns);

    await page.waitForFunction('window.BB && BB.Game && BB.Game.cam', null, { timeout: 8000 });
    /* Give the world a moment to bake. */
    await page.waitForFunction(
      '!!(window.BB && BB.World && BB.World.plants && BB.World.plants.length > 50)',
      null, { timeout: 20000 });
    const plants = await page.evaluate('BB.World.plants.length');
    check('meadow is populated', plants > 50, plants + ' landable plants');

    check('no console errors on load', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  /* ---------------------------------------------------------------- 2 ---- */
  /* The built-in self test, which asserts the reach ladder and that every
     baked sprite really has pixels in it. */
  {
    const { page, errors } = await newPage(browser, '?selftest=1&debug=1');
    await page.waitForFunction('window.__SELFTEST__', null, { timeout: 30000 });
    const st = await page.evaluate('window.__SELFTEST__');
    check('built-in selfTest passes', st.pass,
      st.pass ? 'all assertions held' : st.failures.join(' | '));
    check('selfTest produced no console errors', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  /* ---------------------------------------------------------------- 3 ---- */
  /* Play it: pick a species, fly right and up, confirm the bee moved and the
     canvas is drawing a real scene. */
  {
    const { page, errors } = await newPage(browser, '?species=terrestris&debug=1');
    await page.waitForFunction('window.BB && BB.Game.bee', null, { timeout: 30000 });
    await page.waitForFunction('BB.Game.mode === "playing"', null, { timeout: 30000 });

    const start = await page.evaluate('({x: BB.Game.bee.x, y: BB.Game.bee.y})');

    /* It starts on the ground, cold. Shiver up to flight temperature first -
       exactly what a real bee has to do. */
    await page.keyboard.down('Shift');
    /* Warm past the 30 C takeoff threshold with a margin, exactly as a player
       would - stopping at precisely 30 leaves you cooling back below it. */
    await page.waitForFunction('BB.Game.bee.thoraxC >= 32', null, { timeout: 25000 });
    await page.keyboard.up('Shift');
    const warmed = await page.evaluate('BB.Game.bee.thoraxC');
    check('shivering warms the flight muscles past 30 C', warmed >= 30,
      warmed.toFixed(1) + ' C');

    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(2500);
    await page.keyboard.up('ArrowUp');
    await page.keyboard.up('ArrowRight');

    const after = await page.evaluate(
      '({x: BB.Game.bee.x, y: BB.Game.bee.y, state: BB.Game.bee.state, ' +
      'energy: BB.Game.bee.energy, fps: BB.Debug.fpsAvg})');
    check('the bee flies right when told to', after.x > start.x + 100,
      'moved ' + (after.x - start.x).toFixed(0) + ' px');
    check('the bee gains altitude', after.y < start.y - 40,
      'climbed ' + (start.y - after.y).toFixed(0) + ' px');
    check('flying costs energy', after.energy < 120,
      after.energy.toFixed(1) + ' of 120');

    const probe = await page.evaluate(COLOUR_PROBE);
    check('canvas renders a real scene, not a flat fill', probe.colours > 40,
      probe.colours + ' distinct colours at ' + probe.w + 'x' + probe.h);

    /* Land on a flower and confirm nectar actually transfers. It has to be one
       that is open at the current hour and clear of the world edges, or the bee
       simply cannot get to it - which is correct behaviour, not a bug. */
    const placed = await page.evaluate(`(() => {
      const b = BB.Game.bee;
      const f = BB.World.plants.find(p => p.type.nectarPool > 0 &&
        b.species.tongueMm >= p.type.corollaDepthMm && p.nectar > 3 &&
        p.x > 120 && p.x < BB.World.WIDTH - 120 &&
        BB.isInBloom(p.type, BB.World.hour) && !p.spider);
      if (!f) return { found: false };
      const a = BB.World.anchorWorld(f);
      b.x = a.x; b.y = a.y - 6; b.vx = 0; b.vy = 0;
      window.__TARGET__ = f.typeId;
      return { found: true, id: f.typeId, hour: BB.World.hour };
    })()`);
    check('found an open flower to test on', placed.found,
      placed.found ? placed.id + ' at ' + placed.hour.toFixed(1) + 'h' : 'none in bloom');
    await page.keyboard.down('Space');
    await page.waitForTimeout(2200);
    await page.keyboard.up('Space');
    const drank = await page.evaluate('({nectar: BB.Game.bee.nectar, target: window.__TARGET__})');
    check('drinking from a reachable flower fills the crop', drank.nectar > 1,
      drank.nectar.toFixed(1) + ' mg from ' + drank.target);

    check('no console errors during play', errors.length === 0, errors.join(' | '));
    if (wantShots) {
      await page.screenshot({ path: join(shotDir, 'play.png') });
    }
    await page.close();
  }

  /* ---------------------------------------------------------------- 4 ---- */
  /* A short-tongued bee must be refused by a deep flower. This is the core
     mechanic, so it is checked in the real running game, not just in data. */
  {
    const { page, errors } = await newPage(browser, '?species=terrestris');
    await page.waitForFunction('BB.Game.mode === "playing"', null, { timeout: 30000 });
    const verdict = await page.evaluate(`(() => {
      const b = BB.Game.bee;
      b.thoraxC = 34;
      const deep = BB.World.plants.find(p => p.typeId === 'foxglove');
      if (!deep) return { skipped: true };
      const a = BB.World.anchorWorld(deep);
      b.x = a.x; b.y = a.y - 6;
      return {
        tongue: b.species.tongueMm,
        depth: deep.type.corollaDepthMm,
        canReach: BB.canReach(b.species, deep.type),
        canRob: b.species.canRob
      };
    })()`);
    check('foxglove refuses a short tongue', verdict.skipped || verdict.canReach === false,
      verdict.skipped ? 'no foxglove found' :
        verdict.tongue + ' mm tongue vs ' + verdict.depth + ' mm corolla');
    check('the short-tongued species can still rob', verdict.skipped || verdict.canRob === true);
    check('no console errors in the reach test', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  /* ---------------------------------------------------------------- 5 ---- */
  /* Phone controls. A tap is only a few milliseconds long and can start and
     finish entirely between two frames, so without a minimum hold the touch
     buttons look completely dead to anyone playing on a phone. */
  {
    const context = await browser.newContext({ ...devices['Pixel 5'] });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(indexUrl + '?species=terrestris&hour=11', { waitUntil: 'load' });
    await page.waitForFunction('BB.Game.mode === "playing"', null, { timeout: 30000 });

    const uiVisible = await page.evaluate(
      '!document.getElementById("touch").classList.contains("hidden")');
    check('touch controls appear on a phone', uiVisible);

    /* Every action button has to be reachable and big enough to hit. */
    for (const action of ['probe', 'buzz', 'sip', 'pause']) {
      const box = await page.locator(`[data-action="${action}"]`).boundingBox();
      const size = box ? Math.min(box.width, box.height) : 0;
      const onScreen = box && box.y + box.height <= 727 && box.x >= 0;
      check(`the ${action} button is on screen and tappable`, !!onScreen && size >= 44,
        box ? `${box.width}x${box.height} at ${Math.round(box.x)},${Math.round(box.y)}` : 'missing');
    }

    await page.evaluate(`(() => {
      const bee = BB.Game.bee;
      bee.thoraxC = 34;
      BB.Bee.setState(bee, 'FLYING');
      bee.nectar = 80; bee.energy = 40;
      window.__E0__ = bee.energy; window.__N0__ = bee.nectar;
    })()`);

    const sipBox = await page.locator('[data-action="sip"]').boundingBox();
    await page.touchscreen.tap(sipBox.x + sipBox.width / 2, sipBox.y + sipBox.height / 2);
    await page.waitForTimeout(320);
    const sipped = await page.evaluate('window.__N0__ - BB.Game.bee.nectar');
    check('a single tap on Sip actually drinks nectar', sipped > 0.5,
      sipped.toFixed(2) + ' mg from one tap');

    /* The same latch has to make a tap on Land register, or landing on a
       flower is impossible with a thumb. */
    await page.evaluate(`(() => {
      const b = BB.Game.bee;
      const f = BB.World.plants.find(p => p.type.nectarPool > 0 &&
        b.species.tongueMm >= p.type.corollaDepthMm &&
        BB.isInBloom(p.type, BB.World.hour) && !p.spider &&
        p.x > 120 && p.x < BB.World.WIDTH - 120);
      const a = BB.World.anchorWorld(f);
      b.x = a.x; b.y = a.y - 6; b.vx = 0; b.vy = 0;
    })()`);
    const probeBox = await page.locator('[data-action="probe"]').boundingBox();
    await page.touchscreen.tap(probeBox.x + probeBox.width / 2, probeBox.y + probeBox.height / 2);
    await page.waitForTimeout(120);
    const landed = await page.evaluate('BB.Game.bee.state');
    check('a single tap on Land registers', landed === 'LANDING' || landed === 'LANDED',
      'state ' + landed);

    check('no console errors on a phone', errors.length === 0, errors.join(' | '));
    if (wantShots) await page.screenshot({ path: join(shotDir, 'mobile.png') });
    await context.close();
  }

  /* ---------------------------------------------------------------- 6 ---- */
  /* The sky has to actually change through the day. Screenshots at four hours
     double as the visual record. */
  if (wantShots) {
    for (const [hour, label] of [[5.6, 'dawn'], [13, 'midday'], [19.6, 'dusk'], [20.9, 'night']]) {
      const { page } = await newPage(browser, `?species=hortorum&hour=${hour}`);
      await page.waitForFunction('BB.Game.mode === "playing"', null, { timeout: 30000 });
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(shotDir, `sky-${label}.png`) });
      await page.close();
    }
    for (const sp of ['terrestris', 'lapidarius', 'hortorum', 'pascuorum', 'dahlbomii']) {
      const { page } = await newPage(browser, `?species=${sp}&hour=11`);
      await page.waitForFunction('BB.Game.mode === "playing"', null, { timeout: 30000 });
      await page.evaluate(`(() => {
        const b = BB.Game.bee;
        b.thoraxC = 34;
        BB.Bee.setState(b, 'FLYING');
        b.y = BB.World.GROUND_Y - 300;
        b.throttle = 0.8;
        b.wingBlend = 1.4;
        b.pollen = b.species.pollenCapacity * 0.8;
        b.probeExtend = 1;
      })()`);
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(shotDir, `bee-${sp}.png`) });
      await page.close();
    }
    /* The species select screen, where the portraits live. */
    const { page } = await newPage(browser);
    await page.waitForFunction('BB.World.plants.length > 50', null, { timeout: 20000 });
    await page.click('#btn-play');
    await page.waitForSelector('#screen-species:not(.hidden)', { timeout: 30000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(shotDir, 'species-select.png') });
    await page.close();
    console.log('\nscreenshots written to ' + shotDir);
  }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' checks passed');
  if (failed.length) {
    console.log('failed: ' + failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
