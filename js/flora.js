/* Bumblebee Simulator - the plants, and where they grow.
 *
 * `corollaDepthMm` is the load-bearing number: it is compared directly with the
 * bee's tongue length. The depths below are the working depth a bumblebee has to
 * reach to find the nectar, not the total length of the flower tube.
 *
 * `shape` selects a drawing routine in art.js. `bloomHours` lets a plant close
 * up - honeysuckle only opens towards evening, which is a real reason to risk
 * the late shift.
 */
(function (BB) {
  'use strict';

  var FLOWERS = [
    {
      id: 'bramble',
      commonName: 'Bramble',
      latinName: 'Rubus fruticosus',
      corollaDepthMm: 2,
      nectarPool: 6,
      nectarRegen: 2.0,
      sugarPercent: 30,
      pollenMg: 2.2,
      pollenColor: '#cfc6a4',
      heightPx: 150,
      colorPrimary: '#f6eef2',
      colorSecondary: '#e6b9cd',
      throatColor: '#cfa46c',
      stemColor: '#6b7f47',
      petalCount: 5,
      shape: 'rosaceous',
      bloomHours: [6, 21],
      swayFactor: 0.5,
      spiderChance: 0.16,
      buzzPollinated: false,
      variants: 3,
      note: 'Open, shallow and generous with pollen. Every bumblebee can work it, ' +
        'which is exactly why hedgerows matter.'
    },
    {
      id: 'white_clover',
      commonName: 'White clover',
      latinName: 'Trifolium repens',
      corollaDepthMm: 5,
      nectarPool: 12,
      nectarRegen: 3.0,
      sugarPercent: 40,
      pollenMg: 0.6,
      pollenColor: '#c9b478',
      heightPx: 62,
      colorPrimary: '#fbf7ee',
      colorSecondary: '#e8ddc4',
      throatColor: '#cdd98f',
      stemColor: '#5f8342',
      petalCount: 0,
      shape: 'globe',
      bloomHours: [5, 21],
      swayFactor: 0.35,
      spiderChance: 0.20,
      buzzPollinated: false,
      variants: 3,
      note: 'A head of about forty tiny florets, each one drained separately. ' +
        'Shallow enough for every species.'
    },
    {
      id: 'bittersweet',
      commonName: 'Bittersweet nightshade',
      latinName: 'Solanum dulcamara',
      corollaDepthMm: 3,
      nectarPool: 0,          /* genuinely nectarless */
      nectarRegen: 0,
      sugarPercent: 0,
      pollenMg: 3.0,
      pollenColor: '#f2c93c',
      heightPx: 176,
      colorPrimary: '#8a6bbf',
      colorSecondary: '#6b4fa0',
      throatColor: '#f4d24a',
      stemColor: '#6f7a4a',
      petalCount: 5,
      shape: 'star',
      bloomHours: [6, 20],
      swayFactor: 0.7,
      spiderChance: 0.05,
      /* Pollen is locked inside tube-shaped anthers that only open at a pore.
         Vibrating the flight muscles shakes it loose - honeybees cannot do this. */
      buzzPollinated: true,
      variants: 2,
      note: 'Offers no nectar at all. Its pollen is sealed inside tubular anthers ' +
        'and only comes out if you vibrate: this is buzz pollination, and bumblebees ' +
        'are far better at it than honeybees.'
    },
    {
      id: 'lavender',
      commonName: 'Lavender',
      latinName: 'Lavandula angustifolia',
      corollaDepthMm: 7,
      nectarPool: 8,
      nectarRegen: 4.0,
      sugarPercent: 45,
      pollenMg: 0.5,
      pollenColor: '#c8bcd4',
      heightPx: 172,
      colorPrimary: '#8f7cc4',
      colorSecondary: '#6f5aa6',
      throatColor: '#efe6a8',
      stemColor: '#8a9679',
      petalCount: 0,
      shape: 'spike',
      bloomHours: [6, 21],
      swayFactor: 0.9,
      spiderChance: 0.04,
      buzzPollinated: false,
      variants: 3,
      note: 'Very sugary for its size. A short hop between spikes keeps the ' +
        'energy budget healthy.'
    },
    {
      id: 'bugloss',
      commonName: "Viper's bugloss",
      latinName: 'Echium vulgare',
      corollaDepthMm: 7,
      nectarPool: 10,
      nectarRegen: 9.0,       /* by far the fastest refill in the meadow */
      sugarPercent: 38,
      pollenMg: 1.4,
      pollenColor: '#5a678c',  /* the pollen really is a dark slate blue */
      heightPx: 205,
      colorPrimary: '#4f7bc8',
      colorSecondary: '#8d5fc0',
      throatColor: '#f0e2b0',
      stemColor: '#77855a',
      petalCount: 5,
      shape: 'bugloss',
      bloomHours: [5, 21],
      swayFactor: 0.85,
      spiderChance: 0.06,
      buzzPollinated: false,
      variants: 3,
      note: 'One of the best nectar plants in Europe: it refills within minutes, ' +
        'so you can work the same spike again and again. Its pollen is slate blue.'
    },
    {
      id: 'red_clover',
      commonName: 'Red clover',
      latinName: 'Trifolium pratense',
      corollaDepthMm: 10,
      nectarPool: 18,
      nectarRegen: 3.5,
      sugarPercent: 41,
      pollenMg: 1.0,
      pollenColor: '#a8823f',
      heightPx: 96,
      colorPrimary: '#d1568c',
      colorSecondary: '#a83a70',
      throatColor: '#e8b0c8',
      stemColor: '#5c7f40',
      petalCount: 0,
      shape: 'globe',
      bloomHours: [5, 21],
      swayFactor: 0.4,
      spiderChance: 0.08,
      buzzPollinated: false,
      variants: 3,
      note: 'The classic long-tongue plant. A buff-tailed bumblebee cannot reach ' +
        'the bottom of these florets and has to rob them instead.'
    },
    {
      id: 'comfrey',
      commonName: 'Comfrey',
      latinName: 'Symphytum officinale',
      corollaDepthMm: 13,
      nectarPool: 22,
      nectarRegen: 4.5,
      sugarPercent: 35,
      pollenMg: 0.9,
      pollenColor: '#ddd3b4',
      heightPx: 214,
      colorPrimary: '#b09ad0',
      colorSecondary: '#7d5f9e',
      throatColor: '#e9dcc0',
      stemColor: '#66794a',
      petalCount: 0,
      shape: 'bell_cluster',
      bloomHours: [6, 21],
      swayFactor: 0.75,
      spiderChance: 0.05,
      buzzPollinated: false,
      variants: 3,
      note: 'Drooping tubes, deep enough to shut out most species. Short-tongued ' +
        'bees chew a hole in the side instead of queueing at the front door.'
    },
    {
      id: 'foxglove',
      commonName: 'Foxglove',
      latinName: 'Digitalis purpurea',
      corollaDepthMm: 16,
      nectarPool: 30,
      nectarRegen: 5.0,
      sugarPercent: 30,
      pollenMg: 1.6,
      pollenColor: '#efe8d4',
      heightPx: 342,
      colorPrimary: '#c86ba8',
      colorSecondary: '#9c4a86',
      throatColor: '#f6ecef',
      stemColor: '#5f7548',
      petalCount: 0,
      shape: 'foxglove',
      bloomHours: [6, 21],
      swayFactor: 1.1,
      spiderChance: 0.03,
      buzzPollinated: false,
      variants: 3,
      note: 'The spotted throat is a landing runway painted for bumblebees. You have ' +
        'to crawl right inside, so only the longest tongues get paid.'
    },
    {
      id: 'honeysuckle',
      commonName: 'Honeysuckle',
      latinName: 'Lonicera periclymenum',
      corollaDepthMm: 17,
      nectarPool: 28,
      nectarRegen: 4.0,
      sugarPercent: 28,
      pollenMg: 0.8,
      pollenColor: '#e8d99a',
      heightPx: 296,
      colorPrimary: '#f6ead0',
      colorSecondary: '#e0a45c',
      throatColor: '#fdf6e4',
      stemColor: '#6a7a4c',
      petalCount: 5,
      /* Opens in the late afternoon and scents the evening for moths. */
      bloomHours: [16.5, 23.9],
      shape: 'honeysuckle',
      swayFactor: 0.8,
      spiderChance: 0.03,
      buzzPollinated: false,
      variants: 2,
      note: 'Only opens towards evening, when it releases its scent for night-flying ' +
        'moths. Working it means staying out dangerously close to dusk.'
    },
    {
      id: 'fuchsia',
      commonName: 'Hardy fuchsia',
      latinName: 'Fuchsia magellanica',
      corollaDepthMm: 19,
      nectarPool: 34,
      nectarRegen: 6.0,
      sugarPercent: 22,
      pollenMg: 1.2,
      pollenColor: '#f0dce4',
      heightPx: 268,
      colorPrimary: '#d2325e',
      colorSecondary: '#6b3fa8',
      throatColor: '#f4c6d4',
      stemColor: '#6d7a4e',
      petalCount: 4,
      shape: 'fuchsia',
      bloomHours: [6, 21],
      swayFactor: 1.0,
      spiderChance: 0.02,
      buzzPollinated: false,
      variants: 3,
      note: 'A Patagonian shrub, hanging its flowers upside down. In Chile it is ' +
        'pollinated by hummingbirds and by the giant Bombus dahlbomii, which is the ' +
        'only bee here long-tongued enough to empty one.'
    }
  ];

  var byId = {};
  FLOWERS.forEach(function (f) { byId[f.id] = f; });

  /* ------------------------------------------------------------- zones ---- */

  var WORLD_WIDTH = 6400;

  /* Bands of the meadow, left to right. The nest sits in the hedgerow, and the
     rewards get deeper - and further from home - as you travel right. */
  var ZONES = [
    {
      id: 'hedgerow', from: 0, to: 900,
      label: 'Hedgerow and nest',
      spacing: 46,
      flowers: [['bramble', 5], ['white_clover', 4]]
    },
    {
      id: 'meadow', from: 900, to: 2200,
      label: 'Old meadow',
      spacing: 38,
      flowers: [['white_clover', 5], ['red_clover', 4], ['bugloss', 3], ['bittersweet', 1.6]]
    },
    {
      id: 'garden', from: 2200, to: 3200,
      label: 'Cottage garden',
      spacing: 52,
      flowers: [['lavender', 4], ['comfrey', 3], ['foxglove', 3], ['bugloss', 1.5]]
    },
    {
      id: 'sprayed', from: 3200, to: 3820,
      label: 'Sprayed crop strip',
      sprayed: true,          /* double nectar, but it poisons you */
      spacing: 40,
      flowers: [['red_clover', 4], ['white_clover', 3], ['bugloss', 2]]
    },
    {
      id: 'woodland', from: 3820, to: 4800,
      label: 'Woodland edge',
      spacing: 58,
      flowers: [['honeysuckle', 4], ['foxglove', 3], ['bramble', 3]]
    },
    {
      id: 'botanic', from: 4800, to: WORLD_WIDTH,
      label: 'Botanic garden, Chilean border',
      spacing: 60,
      flowers: [['fuchsia', 6], ['lavender', 2], ['comfrey', 1]]
    }
  ];

  function zoneAt(x) {
    for (var i = 0; i < ZONES.length; i++) {
      if (x >= ZONES[i].from && x < ZONES[i].to) return ZONES[i];
    }
    return ZONES[ZONES.length - 1];
  }

  /* ------------------------------------------------------------- facts ---- */

  /* One is shown on each day-report screen. All of these are true. */
  var FACTS = [
    'A bumblebee cannot take off until its flight muscles are near 30 °C. It warms ' +
      'them by uncoupling its wings and shivering, which is why you see bees sitting ' +
      'still and trembling on cold mornings.',
    'Bumblebees are hairy enough to hold an electrostatic charge, and pollen jumps ' +
      'onto them through the air before they even touch the anthers.',
    'A foraging bumblebee sticks to one kind of flower at a time. Botanists call it ' +
      'flower constancy, and it is what makes bumblebees such effective pollinators.',
    'Buzz pollination works because the bee vibrates its flight muscles at around ' +
      '400 Hz without moving its wings. Tomatoes, blueberries and nightshades all ' +
      'depend on it, and honeybees cannot do it at all.',
    'Only the queen survives the winter. She hibernates alone underground and founds ' +
      'the whole colony by herself in spring, doing all the foraging until her first ' +
      'daughters hatch.',
    'Bumblebees do not make honey to store. They keep a few days of nectar in small ' +
      'wax pots, which is why a week of bad weather can starve a nest.',
    'The crab spider Misumena vatia can change colour over a few days to match the ' +
      'flower it is sitting on, and it kills bees far larger than itself.',
    'Nectar robbing is real: short-tongued bumblebees bite a hole through the base of ' +
      'a deep flower and drink from the side, taking the nectar without pollinating.',
    'Bombus dahlbomii of Patagonia is the largest bumblebee in the world. It has ' +
      'collapsed across its range since commercial European bumblebees were imported ' +
      'into Chile in 1998.',
    "Viper's bugloss refills its flowers with nectar within minutes, so a bee can " +
      'work the same plant repeatedly instead of searching for a fresh one.',
    'A bumblebee colony is small: a few dozen to a few hundred workers, compared with ' +
      'tens of thousands in a honeybee hive.',
    'Bumblebees can fly in colder, wetter, duller weather than honeybees, which is why ' +
      'they matter so much for pollination in northern climates.'
  ];

  BB.FLOWERS = FLOWERS;
  BB.getFlowerType = function (id) { return byId[id]; };
  BB.ZONES = ZONES;
  BB.zoneAt = zoneAt;
  BB.WORLD_WIDTH = WORLD_WIDTH;
  BB.FACTS = FACTS;

  /* Is this plant open for business at this hour? */
  BB.isInBloom = function (type, hour) {
    return hour >= type.bloomHours[0] && hour <= type.bloomHours[1];
  };

})(window.BB = window.BB || {});
