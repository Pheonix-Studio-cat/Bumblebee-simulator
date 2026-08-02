# Bumblebee Simulator

A bumblebee foraging game that runs in the browser. You play a queen founding a colony:
fly the meadow, drink nectar, carry pollen home in your baskets, and raise workers before
the season closes.

Pick one of five real species. Which flowers you can even feed from depends on the length
of your tongue, and every stat comes from the real animal.

**No dependencies, no build step, no install.** Open `index.html` and play.

![the meadow](.smoke-shots/play.png)

---

## Play it

Either way works:

```bash
# 1. Just open the file
open index.html            # macOS
xdg-open index.html        # Linux
# or double-click index.html

# 2. Or serve it, which is closer to how it runs on GitHub Pages
python3 -m http.server 8000
# then visit http://localhost:8000
```

To publish it: push this repository and turn on GitHub Pages for the default branch, root
folder. There is nothing to configure — every file is static and self-contained.

## Controls

| Key | Action |
|---|---|
| `W` `A` `S` `D` or arrows | Fly |
| `Space` | Hold near a flower to land and drink. Hold at the nest to unload. |
| `Shift` | Vibrate your flight muscles — see below |
| `Q` | Sip your own stored nectar to restore energy |
| `P` / `Esc` | Pause |
| `M` | Mute |
| `F3` | Debug overlay |

On a phone there is a thumb stick and buttons instead.

`Shift` does two different things, because in the real animal they are the same action —
vibrating the flight muscles without turning the wings:

- **Grounded and cold** → shiver to warm up.
- **On bittersweet nightshade** → buzz pollination, which shakes pollen out of the flower.

---

## The five species

Tongue length is the number that changes your game the most. It is compared directly with
a flower's corolla depth: if the flower is deeper than your tongue, you cannot drink from
it, and the game tells you both numbers.

| Species | Latin | Body | Tongue | Speed | Load | Flies from | The catch |
|---|---|---|---|---|---|---|---|
| Buff-tailed bumblebee | *Bombus terrestris* | 16 mm | **8 mm** | fast | 170 mg | 6 °C | Too short-tongued for deep flowers, so it **robs** them: bites a hole in the base and drinks from the side |
| Red-tailed bumblebee | *Bombus lapidarius* | 15 mm | 10 mm | fast | 140 mg | **12 °C** | A jet-black solar panel. Loves heat, hates cold mornings, and is slow and expensive to warm up |
| Garden bumblebee | *Bombus hortorum* | 15 mm | **17 mm** | medium | 132 mg | 9 °C | The deep-flower specialist. Earns 25 % extra from anything deeper than 12 mm |
| Common carder bee | *Bombus pascuorum* | 12 mm | 12 mm | nimble | 92 mg | 8 °C | Burns the least energy and turns on a coin, but its honey stomach is tiny and gusts throw it around |
| Giant Patagonian bumblebee | *Bombus dahlbomii* | **24 mm** | **19 mm** | slow | **265 mg** | 10 °C | The world's largest bumblebee. Huge load, and the only one that can empty a Fuchsia — but it overheats above 26 °C |

*Bombus dahlbomii* is endangered. It has collapsed across Patagonia since commercial
*Bombus terrestris* was imported into Chile in 1998, which is why both species are in this
game and why one of them can rob the other's flowers.

## The plants

| Flower | Latin | Corolla depth | Nectar | Notes |
|---|---|---|---|---|
| Bramble | *Rubus fruticosus* | 2 mm | 6 mg | Generous with pollen, open to everyone |
| Bittersweet nightshade | *Solanum dulcamara* | — | **none** | **Buzz-pollinated.** No nectar at all; hold `Shift` to shake the pollen out |
| White clover | *Trifolium repens* | 5 mm | 12 mg | About forty florets per head, each drained separately |
| Lavender | *Lavandula angustifolia* | 7 mm | 8 mg | The sugariest nectar in the meadow |
| Viper's bugloss | *Echium vulgare* | 7 mm | 10 mg | Refills within minutes, so you can work it again and again. Slate-blue pollen |
| Red clover | *Trifolium pratense* | 10 mm | 18 mg | Out of reach for a buff-tailed bumblebee |
| Comfrey | *Symphytum officinale* | 13 mm | 22 mg | Two species can drink it honestly |
| Foxglove | *Digitalis purpurea* | 16 mm | 30 mg | The spotted throat is a landing runway painted for bumblebees |
| Honeysuckle | *Lonicera periclymenum* | 17 mm | 28 mg | **Only opens after 16:30**, so working it means staying out towards dusk |
| Fuchsia | *Fuchsia magellanica* | 19 mm | 34 mg | Patagonian. **Only *B. dahlbomii* can empty one** |

The result is a deliberate ladder: all five species can work clover and bugloss, four can
manage red clover, two can reach foxglove and honeysuckle, and exactly one can drink from
a Fuchsia.

---

## What is actually simulated

Most of the difficulty comes from real bumblebee biology rather than invented rules.

- **You cannot fly with cold muscles.** A bumblebee needs its thorax near **30 °C** before
  it can take off, and it gets there by uncoupling its wings and shivering. On a cold
  morning you sit on the ground and vibrate first, and it costs energy you would rather
  have spent flying. Species differ sharply in how fast and how cheaply they manage it.
- **Nectar robbing.** Short-tongued bumblebees really do bite a hole through the base of a
  deep flower and steal the nectar without pollinating it. It is the buff-tailed
  bumblebee's whole strategy here.
- **Buzz pollination.** Nightshades lock their pollen inside tube-shaped anthers that only
  open at a pore. Bumblebees shake it out by vibrating at around 400 Hz. Honeybees cannot
  do this at all.
- **Flower constancy.** A foraging bumblebee sticks to one kind of flower at a time, which
  is what makes it such an effective pollinator. Visiting the same species repeatedly
  builds a streak and actually pollinates the flowers.
- **The colony is small and has no reserves.** Bumblebees do not hoard honey; they keep a
  few days of nectar in small wax pots. One bad day hurts, two ends the nest.
- **Only the new queens survive.** Everything you build over the season exists to produce a
  handful of young queens who will hibernate and start nests of their own. The workers, the
  pots, and you all die with the autumn.
- **Crab spiders** (*Misumena vatia*) sit colour-matched on pale flowers and ambush bees
  much larger than themselves. Look before you land — they rear up before they strike.
- **Pesticides** are sublethal before they are lethal: the sprayed strip carries double
  nectar, but it degrades your steering and weakens the brood you feed it to.

Each end-of-day report closes with one true fact about bumblebees.

---

## How it is built

Plain HTML, CSS and JavaScript against a 2D canvas. **Zero dependencies and zero assets** —
every bumblebee, flower, tree and cloud is drawn in code at runtime, so there is nothing
that can 404.

```
index.html          canvas, HUD and menus
css/style.css       interface styling
js/util.js          maths, seeded RNG, colour, offscreen canvases
js/species.js       the five species
js/flora.js         the ten plants, the zones, and the facts
js/art.js           all offscreen sprite baking (fur, wings, flowers, scenery)
js/storage.js       localStorage, wrapped so it can never crash the game
js/audio.js         WebAudio synthesis - no audio files
js/input.js         keyboard and touch
js/colony.js        the nest, the brood, quotas and scoring
js/world.js         meadow, clock, temperature, weather, wind, rendering
js/bee.js           flight, thermoregulation, feeding, and drawing the bee
js/hazards.js       birds and crab spiders
js/hud.js           the DOM interface layer
js/game.js          main loop, camera, state machine, self test
tools/smoke-test.mjs  headless browser test (development only)
```

Two decisions are worth knowing about if you edit this:

**Classic `<script>` tags, not ES modules.** Module scripts are blocked by CORS on
`file://` origins, so switching to `import`/`export` would break opening `index.html`
directly. Each file is an IIFE that attaches to one global `BB`, and the script order in
`index.html` is the dependency graph.

**Fur is baked once, never per frame.** Each species gets a few thousand individual hair
strokes with jittered colour, length and angle, drawn into an offscreen canvas during a
short loading beat. The band edges are jittered too, so the yellow stripes read as hairy
boundaries rather than vector shapes. Wings are the same idea in reverse: a bumblebee beats
its wings 130–200 times a second, which 60 fps cannot show, so what is drawn is the
time-averaged blur envelope of the stroke and the real frequency is carried by the audio.

### Development

```bash
node --check js/*.js                  # syntax
node tools/smoke-test.mjs             # headless checks
node tools/smoke-test.mjs --shots     # ...and write screenshots to .smoke-shots/
```

The smoke test needs Playwright (`npm i -g playwright`), which the game itself does not.
It loads the game over `file://` on purpose, so that anyone converting the scripts to ES
modules finds out immediately.

There is also a self test built into the game itself — open `?selftest=1` and check the
console, or read `window.__SELFTEST__`. Among other things it asserts the reach ladder
(that exactly one species can drink from a Fuchsia, two from foxglove, and so on) and that
every baked sprite really contains pixels.

Useful URL parameters: `?debug=1`, `?selftest=1`, `?species=dahlbomii`, `?day=4`,
`?hour=19.5`, `?seed=123`, `?daylen=60`.

---

## Licence

Apache License 2.0 — see [LICENSE](LICENSE).
