'use strict';

/* ===================================================================
 *  Secondary objective decks — DATA LAYER ONLY (mock / prototype)
 *
 *  Per CLAUDE.md §5 "No Faction Assumptions", the Battle Board engine
 *  in app.js must not hardcode card content. This swappable file is the
 *  data layer that supplies the Attacker and Defender secondary decks.
 *
 *  These are placeholder cards for prototyping the draw mechanic — swap
 *  the contents for a real mission pack later without touching app.js.
 *
 *  Schema (one entry per card):
 *    id    stable unique id within its deck
 *    name  card title shown on the board
 *    vp    short scoring descriptor (free text — engine never parses it)
 *    text  one-line description of how the objective scores
 *
 *  Exposed on the global as `window.SECONDARY_DECKS = { attacker, defender }`.
 * =================================================================== */

window.SECONDARY_DECKS = {
  attacker: [
    { id: 'atk-breakthrough', name: 'Breakthrough',      vp: 'Up to 5 VP', text: 'Score 5 VP if you have a unit wholly within the enemy deployment zone at the end of your turn.' },
    { id: 'atk-storm',        name: 'Storm the Line',     vp: 'Up to 4 VP', text: 'Score 2 VP per enemy-held objective marker you take control of this turn (max 4).' },
    { id: 'atk-behind',       name: 'Behind Enemy Lines', vp: 'Up to 5 VP', text: 'Score 4 VP if one unit, or 5 VP if two units, are in the enemy deployment zone.' },
    { id: 'atk-press',        name: 'Press the Advantage',vp: 'Up to 5 VP', text: 'Score VP equal to the number of enemy units destroyed this turn, to a maximum of 5.' },
    { id: 'atk-overrun',      name: 'Overrun',            vp: 'Up to 6 VP', text: 'Score 3 VP if you made a Charge move this turn; 6 VP if you also destroyed the charged unit.' },
    { id: 'atk-vanguard',     name: 'Vanguard Strike',    vp: 'Up to 4 VP', text: 'Score 4 VP if you control an objective marker outside your own deployment zone.' },
    { id: 'atk-seize',        name: 'Seize Ground',       vp: 'Up to 5 VP', text: 'Score 2 VP per objective marker you control beyond the first (max 5).' },
    { id: 'atk-decap',        name: 'Decapitation',       vp: 'Up to 5 VP', text: 'Score 5 VP if you destroy the enemy CHARACTER with the highest points value this turn.' }
  ],
  defender: [
    { id: 'def-hold',         name: 'Hold the Line',      vp: 'Up to 5 VP', text: 'Score 5 VP if you control every objective marker within your own deployment zone.' },
    { id: 'def-entrenched',   name: 'Entrenched',         vp: 'Up to 4 VP', text: 'Score 2 VP per objective marker you control that you also controlled last turn (max 4).' },
    { id: 'def-repel',        name: 'Repel Boarders',     vp: 'Up to 5 VP', text: 'Score VP equal to enemy units destroyed within 6" of your deployment zone (max 5).' },
    { id: 'def-network',      name: 'Defensive Network',  vp: 'Up to 4 VP', text: 'Score 4 VP if you control two or more objective markers and lost no units this turn.' },
    { id: 'def-noprisoners',  name: 'No Prisoners',       vp: 'Up to 5 VP', text: 'Score 1 VP per enemy unit destroyed this turn, to a maximum of 5.' },
    { id: 'def-laststand',    name: 'Last Stand',         vp: 'Up to 6 VP', text: 'Score 3 VP if your Warlord is on the battlefield at end of turn; 6 VP if also above half wounds.' },
    { id: 'def-heartland',    name: 'Secure Heartland',   vp: 'Up to 4 VP', text: 'Score 4 VP if no enemy units are within your deployment zone at the end of your turn.' },
    { id: 'def-counter',      name: 'Counter-Offensive',  vp: 'Up to 5 VP', text: 'Score 5 VP if you retook an objective marker the enemy controlled at the start of your turn.' }
  ]
};
