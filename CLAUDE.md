# About

This project is a companion app for Warhammer 40k players. It allows users to execute and evaluate complex combat pipelines for both theoretical simulation and real-time tabletop play. The application is completely **army-agnostic**, focusing on universal core mechanics (Attacks, Weapon Skill, Ballistic Skill, Strength, Toughness, Armor Penetration, Saves, and Damage) rather than hardcoded faction rules, allowing maximum flexibility across updates and editions.

---

# Core Principles & Developer Guidelines

## 1. UI/UX: Mobile-First Approach & Tabletop Ergonomics
* **One-Handed Usability:** Designing for a tabletop environment means the user often holds a miniature or dice in one hand. Primary actionable elements (buttons, sliders, dice counters) must reside within the natural reach of a thumb (lower 60% of the screen).
* **Touch Target Standards:** Minimum touch target sizes must be 48x48dp with adequate padding to avoid accidental taps during fast-paced games.
* **High Contrast & Readability:** Games are often played in dimly lit local game stores or bright convention halls. Default to a high-contrast dark mode with crisp typography. Important metrics (e.g., remaining wounds, success counts) must be immediately scannable from 2–3 feet away.
* **Haptic Feedback & Micro-interactions:** Provide tactile haptic patterns for heavy operations (e.g., rolling 40 dice, failing a critical save) to enhance the app's physical, game-like feel.

## 2. The Philosophy of Simplicity
* **Zero Congestion:** Do not clutter the screen with massive tables or secondary data. Break the combat pipeline into discrete, bite-sized steps (e.g., Step 1: Hit Roll -> Step 2: Wound Roll -> Step 3: Save Roll).
* **Contextual Inputs:** Only show input fields relevant to the current state. If a weapon has a flat Damage characteristic of 2, hide the "Roll Damage" phase controls completely.
* **Fast Resets:** Tabletop play requires rapid iterations. Implement a single-tap "Clear/Reset" action accessible at all times to wipe current pipeline state for the next attack sequence.
* **Smart Defaults:** Pre-populate fields with the most statistically common values (e.g., BS 3+, Strength 4, Toughness 4) to minimize setup friction.

## 3. Engineering & Architectural Standards
* **Deterministic Simulation vs. RNG Play:** Ensure the core math engine supports both explicit pseudo-random number generation (PRNG) for real-time play simulation and statistical averaging (MathMando calculations) for quick theory-crafting.
* **State Machine Pipeline:** The combat pipeline must behave like a strict, unidirectional state machine:
    $$\\text{Inputs} \\longrightarrow \\text{Attacks/Hits} \\longrightarrow \\text{Wounding} \\longrightarrow \\text{Allocating/Saves} \\longrightarrow \\text{Damage Resolution}$$
* **Immutability:** Game states, roll profiles, and simulation results must be treated as immutable structures. Any modification must emit a new state rather than mutating the active pipeline directly.
* **Performance Optimization:** When running large simulations (e.g., 10,000 iterations of an attack pipeline), offload calculations from the main UI thread using workers or background tasks to prevent UI stuttering.

## 4. Warhammer 40k Domain Modeling Rules
When writing structures, types, or components, map them accurately to the following universal constraints:
* **Dice Mechanics:** All core rolls are based on standard 6-sided dice (D6) or variables like D3, D6+1, etc.
* **Modifiers:** Ensure all modifiers obey the current core rule constraints (e.g., hit and wound modifiers are capped at a net +1 or -1 after all calculations, but unmodified rolls of '1' always fail and unmodified '6' always succeeds).
* **Re-roll Mechanics:** State handling must cleanly accommodate variations: Re-roll 1s, Re-roll failed rolls, Re-roll all rolls, or specific conditional single dice re-rolls. Re-rolls always occur *before* modifiers are applied.

## 5. Interaction & AI Behavior Rules
* **Always Ask Clarifying Questions:** Warhammer 40k has thousands of edge cases. If a technical task, state mutation, or UI layout edge-case is ambiguous, stop and ask clarifying questions before generating code.
* **Incremental Deliverables:** Write code modularly. Do not provide 500-line monolithic files. Break logic into pure mathematical hooks/utilities, layout templates, and state managers.
* **No Faction Assumptions:** Never hardcode faction names, detachment rules, or specific unit profiles (e.g., "Space Marine Intercessor") into core engine schemas. Use descriptive generic properties instead (e.g., "Sustained Hits 1", "Devastating Wounds", "Twin-linked").

---

# Project Layout

```
D6-Pipeline/
├── index.html          # UI shell — Pipeline tab + Quick Roll tab
├── app.js              # Vanilla JS: dice parser, weapon cards, pipeline engine
├── styles.css          # Dark-mode tabletop styling
├── README.md
├── LICENSE
└── Resources/          # Reference material — NOT shipped to the client
    └── Core Rules.pdf  # Warhammer 40k 10th-edition Core Rules (Wahapedia mirror, 75 pp)
```

## The `Resources/` directory

`Resources/` holds canonical reference material that informs the rules engine but is never bundled into the runtime. Treat its contents as **read-only source of truth** when the engine and the rules disagree.

* **`Core Rules.pdf`** — full 10th-edition Core Rules. The authoritative document for the attack sequence (Hit → Wound → Allocate → Save → Damage), modifier caps, re-roll ordering, weapon abilities ([SUSTAINED HITS], [LETHAL HITS], [DEVASTATING WOUNDS], [TWIN-LINKED], [LANCE], [MELTA], [BLAST], [TORRENT], [ANTI-x+], etc.), Feel No Pain, mortal wounds, and characteristic clamps. Consult this PDF before changing pipeline behavior, adding a weapon ability, or resolving any ambiguity about edge cases.
* When adding new reference material (FAQs, errata, designer's commentary), drop it here and update this section.
* Anything in `Resources/` is intentionally excluded from the deployable site — do not link to it from `index.html` or load it at runtime.

---

# Reference Schema Strategy (For Code Generation)

When generating domain models, keep the universal attack-sequence vocabulary decoupled from any faction- or unit-specific data. Sketch:

```
Weapon       { name, attacks, hitTarget(BS|WS), strength, ap, damage, abilities[] }
Ability      { kind: 'SUSTAINED_HITS'|'LETHAL'|'DEVASTATING'|'TWIN_LINKED'|'LANCE'|'MELTA'|'BLAST'|'TORRENT'|'ANTI'|'IGNORES_COVER', value? }
Target       { toughness, save, invuln, wounds, modelCount, fnp, defensiveMods[] }
Pipeline     { hit → wound → allocate → save → damage }  // strict unidirectional
RollResult   { attempted, critical, normal, failed }     // immutable per phase
```

Generic properties only — no faction names, datasheet IDs, or detachment rules in the engine. Presets that reference real units belong in a separate, swappable data layer (see [app.js](app.js) `TARGET_PROFILES`).