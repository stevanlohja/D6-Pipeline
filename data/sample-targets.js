'use strict';

/* ===================================================================
 *  Sample target presets — DATA LAYER ONLY
 *
 *  Per CLAUDE.md §5 "No Faction Assumptions", the engine (app.js) must
 *  not reference faction-specific units. This file is the swappable
 *  data layer that supplies sample profiles for the Target dropdown.
 *
 *  Schema (one entry per preset):
 *    key            stable id used by index.html option value
 *    label          human-readable name shown in the dropdown
 *    t              Toughness
 *    sv             armour save (2..6)
 *    inv            invulnerable save (0 = none, else 2..6)
 *    w              wounds per model
 *    isSingleModel  true for vehicles/monsters (no half/full sizing)
 *    halfSize       roster size at "half strength"
 *    fullSize       roster size at "full strength"
 *
 *  Exposed on the global as `window.SAMPLE_TARGETS` for the engine to
 *  consume without a build step.
 * =================================================================== */

window.SAMPLE_TARGETS = [
  { key: 'intercessor',    label: 'Space Marine Intercessor', t: 4,  sv: 3, inv: 0, w: 2,  isSingleModel: false, halfSize: 5,  fullSize: 10 },
  { key: 'terminator',     label: 'Space Marine Terminator',  t: 5,  sv: 2, inv: 4, w: 3,  isSingleModel: false, halfSize: 5,  fullSize: 10 },
  { key: 'custodian',      label: 'Custodian Guard',          t: 6,  sv: 2, inv: 4, w: 3,  isSingleModel: false, halfSize: 4,  fullSize: 5  },
  { key: 'ork_boy',        label: 'Ork Boy',                  t: 5,  sv: 6, inv: 0, w: 1,  isSingleModel: false, halfSize: 10, fullSize: 20 },
  { key: 'gaunt',          label: 'Tyranid Gaunt',            t: 3,  sv: 5, inv: 0, w: 1,  isSingleModel: false, halfSize: 10, fullSize: 20 },
  { key: 'necron_warrior', label: 'Necron Warrior',           t: 4,  sv: 4, inv: 0, w: 1,  isSingleModel: false, halfSize: 10, fullSize: 20 },
  { key: 'land_raider',    label: 'Land Raider (Vehicle)',    t: 12, sv: 2, inv: 0, w: 16, isSingleModel: true,  halfSize: 1,  fullSize: 1  },
  { key: 'knight',         label: 'Imperial Knight (Vehicle)',t: 12, sv: 3, inv: 5, w: 22, isSingleModel: true,  halfSize: 1,  fullSize: 1  }
];
