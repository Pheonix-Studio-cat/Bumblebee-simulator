/* Bumblebee Simulator - the five playable species.
 *
 * Every number here is anchored to the real animal. The one that matters most
 * for play is `tongueMm`: it is compared directly against a flower's corolla
 * depth, so a short-tongued bee physically cannot drain a deep flower.
 *
 * Tongue lengths across the five species are 8 / 10 / 12 / 17 / 19 mm, which
 * produces a deliberate ladder of flower access:
 *   all five  -> bramble, white clover, lavender, viper's bugloss
 *   four      -> red clover      (10 mm)
 *   two       -> comfrey, foxglove, honeysuckle (13-17 mm)
 *   one       -> Fuchsia magellanica (19 mm)  <- Bombus dahlbomii only
 *
 * `bands` drives the fur baker in art.js. Each entry covers a stretch of the
 * body from head-front (u = 0) to abdomen-tip (u = 1) and carries an [h, s, l]
 * colour. Band edges are jittered while baking so the stripes read as hairy
 * boundaries rather than crisp vector edges.
 */
(function (BB) {
  'use strict';

  var BLACK      = [32, 8, 10];
  var JET        = [275, 7, 7];
  var OCHRE      = [44, 64, 40];   /* B. terrestris has dirty, dark-yellow bands */
  var LEMON      = [50, 78, 52];   /* B. hortorum's bands are brighter and cleaner */
  var BUFF       = [42, 32, 76];
  var WHITE_TAIL = [48, 18, 90];
  var RUST       = [14, 86, 47];
  var GINGER     = [26, 68, 45];

  var SPECIES = [
    {
      id: 'terrestris',
      commonName: 'Buff-tailed bumblebee',
      latinName: 'Bombus terrestris',
      difficulty: 1,

      bodyLengthMm: 16,
      tongueMm: 8,
      wingbeatHz: 180,
      sizeScale: 1.02,
      bodyAspect: 1.00,
      massFactor: 1.10,

      maxSpeed: 380,
      accel: 900,
      agility: 0.62,

      nectarCapacity: 170,
      pollenCapacity: 22,
      probeRate: 9.0,
      pollenRate: 0.90,

      energyMax: 120,
      energyDrain: 1.15,

      coldToleranceC: 6,
      heatToleranceC: 29,
      shiverRate: 2.0,
      solarGain: 0.15,

      /* Short tongue, but a real workaround: this species bites a hole through
         the base of a deep corolla and steals the nectar. It is called nectar
         robbing and it is why terrestris is never locked out of a flower. */
      canRob: true,
      robYield: 0.45,
      robSeconds: 2.0,
      deepBonus: 1.0,
      nativeFlowers: [],

      hairLength: 1.0,
      hairDensity: 1.0,
      eyeHue: 30,
      bands: [
        { from: 0.00, to: 0.17, hsl: BLACK },
        { from: 0.17, to: 0.26, hsl: OCHRE },
        { from: 0.26, to: 0.44, hsl: BLACK },
        { from: 0.44, to: 0.55, hsl: OCHRE },
        { from: 0.55, to: 0.78, hsl: BLACK },
        { from: 0.78, to: 1.00, hsl: BUFF }
      ],

      blurb: 'The commonest big bumblebee in Europe: fast, strong and happy to fly ' +
        'on cold mornings. Its tongue is too short for deep flowers, so it cheats ' +
        'by biting a hole at the base and robbing the nectar.',
      conservationNote: 'Abundant and expanding. Exported worldwide for greenhouse ' +
        'pollination, which is how it reached Chile.'
    },

    {
      id: 'lapidarius',
      commonName: 'Red-tailed bumblebee',
      latinName: 'Bombus lapidarius',
      difficulty: 3,

      bodyLengthMm: 15,
      tongueMm: 10,
      wingbeatHz: 175,
      sizeScale: 0.98,
      bodyAspect: 1.00,
      massFactor: 1.00,

      maxSpeed: 345,
      accel: 865,
      agility: 0.70,

      nectarCapacity: 140,
      pollenCapacity: 18,
      probeRate: 8.0,
      pollenRate: 0.80,

      energyMax: 110,
      energyDrain: 1.05,

      /* Needs the warmest thorax of the five before it will leave the ground,
         but its jet-black coat soaks up sunshine faster than anyone. */
      coldToleranceC: 12,
      heatToleranceC: 32,
      shiverRate: 1.3,
      solarGain: 0.35,

      canRob: false,
      robYield: 0,
      robSeconds: 0,
      deepBonus: 1.0,
      nativeFlowers: [],

      hairLength: 0.95,
      hairDensity: 1.05,
      eyeHue: 22,
      bands: [
        { from: 0.00, to: 0.64, hsl: JET },
        { from: 0.64, to: 0.71, hsl: [16, 60, 26] },
        { from: 0.71, to: 1.00, hsl: RUST }
      ],

      blurb: 'Jet black with a fiery red tail. That dark coat is a solar panel, so ' +
        'it thrives on hot dry banks, but it is reluctant and slow to warm up on a ' +
        'cold morning.',
      conservationNote: 'Still widespread, though it has retreated from intensively ' +
        'farmed land.'
    },

    {
      id: 'hortorum',
      commonName: 'Garden bumblebee',
      latinName: 'Bombus hortorum',
      difficulty: 2,

      bodyLengthMm: 15,
      tongueMm: 17,
      wingbeatHz: 165,
      sizeScale: 1.00,
      bodyAspect: 0.90,   /* noticeably longer and slimmer, with a long face */
      massFactor: 0.92,

      maxSpeed: 320,
      accel: 820,
      agility: 0.66,

      nectarCapacity: 132,
      pollenCapacity: 17,
      probeRate: 7.5,
      pollenRate: 0.75,

      energyMax: 108,
      energyDrain: 1.00,

      coldToleranceC: 9,
      heatToleranceC: 28,
      shiverRate: 1.5,
      solarGain: 0.12,

      canRob: false,
      robYield: 0,
      robSeconds: 0,
      /* Rewarded for doing what only it can do. */
      deepBonus: 1.25,
      nativeFlowers: [],

      hairLength: 1.05,
      hairDensity: 1.0,
      eyeHue: 34,
      bands: [
        { from: 0.00, to: 0.13, hsl: BLACK },
        { from: 0.13, to: 0.225, hsl: LEMON },
        { from: 0.225, to: 0.325, hsl: BLACK },
        { from: 0.325, to: 0.415, hsl: LEMON },
        { from: 0.415, to: 0.445, hsl: BLACK },   /* thin dark line at the waist */
        { from: 0.445, to: 0.535, hsl: LEMON },
        { from: 0.535, to: 0.79, hsl: BLACK },
        { from: 0.79, to: 1.00, hsl: WHITE_TAIL }
      ],

      blurb: 'A long-faced bee with a tongue almost as long as its body. The only ' +
        'common species that can drink honestly from a foxglove, and it earns extra ' +
        'nectar from every deep flower it works.',
      conservationNote: 'Widespread but declining as old flower-rich meadows are lost.'
    },

    {
      id: 'pascuorum',
      commonName: 'Common carder bee',
      latinName: 'Bombus pascuorum',
      difficulty: 2,

      bodyLengthMm: 12,
      tongueMm: 12,
      wingbeatHz: 190,
      sizeScale: 0.84,
      bodyAspect: 1.00,
      massFactor: 0.78,

      maxSpeed: 360,
      accel: 980,
      agility: 0.92,

      nectarCapacity: 92,
      pollenCapacity: 13,
      probeRate: 7.0,
      pollenRate: 0.85,

      energyMax: 96,
      energyDrain: 0.85,

      coldToleranceC: 8,
      heatToleranceC: 29,
      shiverRate: 1.6,
      solarGain: 0.10,

      canRob: false,
      robYield: 0,
      robSeconds: 0,
      deepBonus: 1.0,
      nativeFlowers: [],

      hairLength: 1.1,
      hairDensity: 1.05,
      eyeHue: 28,
      bands: [
        { from: 0.00, to: 0.14, hsl: [26, 44, 26] },
        { from: 0.14, to: 0.42, hsl: GINGER },
        { from: 0.42, to: 0.55, hsl: [28, 58, 43] },
        { from: 0.55, to: 0.645, hsl: [24, 26, 28] },
        { from: 0.645, to: 0.76, hsl: [30, 62, 48] },
        { from: 0.76, to: 0.855, hsl: [24, 26, 31] },
        { from: 0.855, to: 1.00, hsl: [30, 68, 51] }
      ],

      blurb: 'Small, ginger and extremely nimble. It burns the least energy of the ' +
        'five and turns on a coin, but its honey stomach is tiny, so it lives by ' +
        'making many short trips. Gusts throw it around badly.',
      conservationNote: 'The longest flight season of any bumblebee here, on the wing ' +
        'from March into November.'
    },

    {
      id: 'dahlbomii',
      commonName: 'Giant Patagonian bumblebee',
      latinName: 'Bombus dahlbomii',
      difficulty: 4,

      bodyLengthMm: 24,
      tongueMm: 19,
      wingbeatHz: 130,
      sizeScale: 1.62,
      bodyAspect: 1.06,
      massFactor: 1.55,

      maxSpeed: 272,
      accel: 620,
      agility: 0.38,

      nectarCapacity: 265,
      pollenCapacity: 34,
      probeRate: 11.0,
      pollenRate: 1.30,

      energyMax: 152,
      energyDrain: 1.55,

      coldToleranceC: 10,
      /* Cool temperate Patagonian animal: overheats where others are comfortable. */
      heatToleranceC: 26,
      shiverRate: 1.1,
      solarGain: 0.20,

      canRob: false,
      robYield: 0,
      robSeconds: 0,
      deepBonus: 1.10,
      nativeFlowers: ['fuchsia'],

      /* Famously long, dense, shaggy coat. */
      hairLength: 1.4,
      hairDensity: 1.2,
      eyeHue: 20,
      bands: [
        { from: 0.00, to: 0.12, hsl: [16, 58, 26] },
        { from: 0.12, to: 0.86, hsl: [16, 84, 47] },
        { from: 0.86, to: 1.00, hsl: [21, 86, 55] }
      ],

      blurb: 'The largest bumblebee on Earth, up to 40 mm across, covered in shaggy ' +
        'orange fur. Slow and heavy, but it carries an enormous load and it is the ' +
        'only bee here that can drink from a Fuchsia.',
      conservationNote: 'Endangered. It has collapsed across Patagonia since ' +
        'commercial Bombus terrestris was imported into Chile in 1998.'
    }
  ];

  var byId = {};
  SPECIES.forEach(function (sp) { byId[sp.id] = sp; });

  BB.SPECIES = SPECIES;

  BB.getSpecies = function (id) {
    return byId[id] || SPECIES[0];
  };

  /* Can this bee drink from that corolla at all? Tongue against depth, no
     hidden fudge factor - the player is shown both numbers. */
  BB.canReach = function (species, flowerType) {
    return species.tongueMm >= flowerType.corollaDepthMm;
  };

  /* Deep-flower specialists earn a bonus on anything genuinely deep, and a
     species gets extra from the plants it evolved alongside. */
  BB.yieldMultiplier = function (species, flowerType) {
    var m = 1;
    if (flowerType.corollaDepthMm >= 12) m *= species.deepBonus;
    if (species.nativeFlowers.indexOf(flowerType.id) >= 0) m *= 1.15;
    return m;
  };

  /* Descriptive tier used on the species cards. */
  BB.tongueLabel = function (species) {
    var t = species.tongueMm;
    if (t <= 8) return 'short';
    if (t <= 10) return 'medium';
    if (t <= 13) return 'long';
    return 'very long';
  };

})(window.BB = window.BB || {});
