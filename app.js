'use strict';

/* ===================================================================
 *  D6 Pipeline — attack resolver + quick dice roller
 *  Single-file vanilla JS. State lives in the DOM and localStorage.
 * =================================================================== */

// ───────────────────────────────────────────────────────────────────
//  Constants
// ───────────────────────────────────────────────────────────────────

// Target presets come from the swappable data layer (data/sample-targets.js)
// so the engine stays faction-agnostic per CLAUDE.md §5.
const TARGET_PROFILES = (() => {
  const list = (typeof window !== 'undefined' && window.SAMPLE_TARGETS) || [];
  const out = {};
  for (const p of list) {
    out[p.key] = {
      name: p.label, t: p.t, sv: p.sv, inv: p.inv, w: p.w,
      isSingleModel: p.isSingleModel, halfSize: p.halfSize, fullSize: p.fullSize
    };
  }
  return out;
})();

const ATTACK_CHIPS = ['1', '2', '3', '4', '5', '6', 'D3', 'D6', 'D6+1', '2D6'];
const DAMAGE_CHIPS = ['1', '2', '3', 'D3', 'D3+3', 'D6', 'D6+1', 'D6+2', '2D6'];
const SUSTAINED_OPTS = ['0', '1', '2', '3', 'D3'];
const HIT_TARGETS = [2, 3, 4, 5, 6];
const AP_VALUES = [0, -1, -2, -3, -4, -5];
const CRIT_HIT_THRESHOLDS = [6, 5, 4];
const CRIT_WOUND_THRESHOLDS = [6, 5, 4, 3, 2];
const HIT_MOD_OPTS = [-1, 0, 1];
const FNP_OPTS = [0, 6, 5, 4, 3];

// ───────────────────────────────────────────────────────────────────
//  Click sound (synthesized via Web Audio API)
//  A short triangle-wave sweep with low gain — a "soft modern click."
//  No external audio asset; tone shape is encoded in code so it can be
//  tuned without re-recording. Context is created lazily on the first
//  user gesture to comply with browser autoplay policies.
// ───────────────────────────────────────────────────────────────────

let _audioCtx = null;
function getAudioCtx() {
  if (_audioCtx) return _audioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { _audioCtx = new AC(); } catch (_) { return null; }
  return _audioCtx;
}

function playClick() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();

  const now = ctx.currentTime;

  // ── Layer 1: tonal body — the deep "tock" ──
  // Triangle sweep 500 → 180 Hz over 25 ms keeps the click rooted in the
  // lower mids, like an iOS / Gboard keystroke. Lowpass at 1.2 kHz keeps
  // any harmonics from poking through and brightening the sound.
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(500, now);
  osc.frequency.exponentialRampToValueAtTime(180, now + 0.025);

  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.0001, now);
  oscGain.gain.linearRampToValueAtTime(0.09, now + 0.0005);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

  const oscLp = ctx.createBiquadFilter();
  oscLp.type = 'lowpass';
  oscLp.frequency.value = 1200;
  oscLp.Q.value = 0.5;

  osc.connect(oscLp).connect(oscGain).connect(ctx.destination);

  // ── Layer 2: tap transient — the brief "finger touches glass" texture ──
  // 8 ms of bandpassed white noise gives the body something to sit on top
  // of so the click feels percussive rather than purely tonal.
  const noiseDur = 0.008;
  const noiseBuf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * noiseDur)), ctx.sampleRate);
  const ndata = noiseBuf.getChannelData(0);
  for (let i = 0; i < ndata.length; i++) ndata[i] = Math.random() * 2 - 1;

  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;

  const noiseBp = ctx.createBiquadFilter();
  noiseBp.type = 'bandpass';
  noiseBp.frequency.value = 700;
  noiseBp.Q.value = 3;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.linearRampToValueAtTime(0.04, now + 0.0003);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.008);

  noiseSrc.connect(noiseBp).connect(noiseGain).connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.05);
  noiseSrc.start(now);
}

// ───────────────────────────────────────────────────────────────────
//  Dice expression parser
// ───────────────────────────────────────────────────────────────────

function rollD6() { return Math.floor(Math.random() * 6) + 1; }
function rollDN(n) { return Math.floor(Math.random() * n) + 1; }

// ── Old-browser compat helpers ──────────────────────────────────────
// The Kindle Scribe browser is an old WebKit without optional chaining
// (?.) or nullish coalescing (??). These keep the engine parseable there
// without pulling in a build/transpile step (the project ships raw JS).
function valOf(el) { return el ? el.value : undefined; }
function isChecked(id) { const el = document.getElementById(id); return !!(el && el.checked); }

function parseDice(expr) {
  if (typeof expr === 'number') return { count: 0, sides: 0, mod: expr };
  const s = String(expr == null ? '' : expr).trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;
  if (/^-?\d+$/.test(s)) return { count: 0, sides: 0, mod: parseInt(s, 10) };
  const m = s.match(/^(\d*)D([36])([+-]\d+)?$/);
  if (!m) return null;
  const count = m[1] === '' ? 1 : parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  const mod = m[3] ? parseInt(m[3], 10) : 0;
  if (count < 1 || count > 30) return null;
  return { count, sides, mod };
}

function rollDiceExpr(expr) {
  const p = parseDice(expr);
  if (!p) return 0;
  let total = p.mod;
  for (let i = 0; i < p.count; i++) total += rollDN(p.sides);
  return Math.max(0, total);
}

function avgDiceExpr(expr) {
  const p = parseDice(expr);
  if (!p) return 0;
  return p.count * (p.sides + 1) / 2 + p.mod;
}

function isValidDiceExpr(expr) {
  return parseDice(expr) !== null;
}

function formatAvg(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ───────────────────────────────────────────────────────────────────
//  Tutorial dialog
// ───────────────────────────────────────────────────────────────────

function openTutorial() {
  const dlg = document.getElementById('tutorialDialog');
  if (!dlg) return;
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}

function closeTutorial() {
  const dlg = document.getElementById('tutorialDialog');
  if (!dlg) return;
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
}

// ───────────────────────────────────────────────────────────────────
//  Tabs
// ───────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tab-button').forEach(b => {
    b.dataset.active = String(b.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.dataset.active = String(p.dataset.tab === name);
  });
}

// Theme (default dark vs. e-ink) is handled entirely by the small inline
// script in index.html's <head> so it keeps working even when a low-powered
// e-ink browser struggles to load this bundle. Nothing theme-related here.

// ───────────────────────────────────────────────────────────────────
//  Toast
// ───────────────────────────────────────────────────────────────────

function toast(msg, type = '') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ───────────────────────────────────────────────────────────────────
//  Section / collapsible helpers
// ───────────────────────────────────────────────────────────────────

function toggleSection(headerEl) {
  const section = headerEl.closest('[data-collapsible]');
  if (!section) return;
  const collapsed = section.dataset.collapsed === 'true';
  section.dataset.collapsed = String(!collapsed);
}

// ───────────────────────────────────────────────────────────────────
//  Target
// ───────────────────────────────────────────────────────────────────

function readTargetState() {
  const key = document.getElementById('targetUnitSelect').value;
  const hasTarget = key !== 'none';

  let base;
  let modelCount = 1;

  if (key === 'custom') {
    const isSingle = document.getElementById('custType').value === 'single';
    base = {
      name: document.getElementById('custName').value || 'Custom Target',
      t: parseInt(document.getElementById('custT').value, 10) || 4,
      sv: parseInt(document.getElementById('custSv').value, 10) || 4,
      inv: parseInt(document.getElementById('custInv').value, 10) || 0,
      w: parseInt(document.getElementById('custW').value, 10) || 1,
      isSingleModel: isSingle
    };
    modelCount = isSingle ? 1 : (parseInt(document.getElementById('custSize').value, 10) || 5);
  } else if (hasTarget) {
    const p = TARGET_PROFILES[key];
    base = Object.assign({}, p);
    const sizeMode = document.getElementById('unitSizeSelect').value;
    modelCount = p.isSingleModel ? 1 : (sizeMode === 'full' ? p.fullSize : p.halfSize);
  } else {
    base = null;
  }

  // Defensive modifiers (apply regardless of preset)
  const cover = isChecked('defCover');
  const minusOneDamage = isChecked('defMinusDmg');
  const halveDamage = isChecked('defHalveDmg');
  const stealthHit = isChecked('defStealth');
  const minusOneWound = isChecked('defMinusWound');
  const fnp = parseInt(getCheckedKeypad('defFnp') || '0', 10);

  if (base) {
    return {
      hasTarget: true,
      target: Object.assign({}, base, { modelCount, cover, minusOneDamage, halveDamage, stealthHit, minusOneWound, fnp })
    };
  }
  return {
    hasTarget: false,
    target: { modelCount: 0, cover, minusOneDamage, halveDamage, stealthHit, minusOneWound, fnp }
  };
}

function updateTargetUi() {
  const key = document.getElementById('targetUnitSelect').value;
  const sizeSelect = document.getElementById('unitSizeSelect');
  const customPanel = document.getElementById('customUnitPanel');
  const statsRow = document.getElementById('targetStatsDisplay');

  if (key === 'custom') {
    customPanel.hidden = false;
    sizeSelect.hidden = true;
    toggleCustomSizeField();
    statsRow.textContent = 'Custom — set defensive attributes below.';
  } else if (key === 'none') {
    customPanel.hidden = true;
    sizeSelect.hidden = true;
    statsRow.textContent = 'Raw mode — pipeline outputs hit/wound counts only.';
  } else {
    customPanel.hidden = true;
    const p = TARGET_PROFILES[key];
    if (p.isSingleModel) {
      sizeSelect.hidden = true;
    } else {
      sizeSelect.hidden = false;
      // Only repopulate when the unit actually changes — otherwise we'd
      // reset the user's half/full selection on every onchange.
      if (sizeSelect.dataset.unit !== key) {
        sizeSelect.innerHTML = `
          <option value="half">Half Strength (${p.halfSize} models)</option>
          <option value="full">Full Strength (${p.fullSize} models)</option>
        `;
        sizeSelect.dataset.unit = key;
      }
    }
    const size = p.isSingleModel ? 1 : (sizeSelect.value === 'full' ? p.fullSize : p.halfSize);
    let txt = `T${p.t} · Sv ${p.sv}+`;
    if (p.inv > 0) txt += ` · Inv ${p.inv}+`;
    txt += ` · W${p.w} · ${size} model${size !== 1 ? 's' : ''}`;
    statsRow.textContent = txt;
  }

  syncWeaponInputFields();
}

function toggleCustomSizeField() {
  const type = document.getElementById('custType').value;
  document.getElementById('custSizeDiv').hidden = (type === 'single');
}

// ───────────────────────────────────────────────────────────────────
//  Keypad / pill helpers
// ───────────────────────────────────────────────────────────────────

function getCheckedKeypad(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : null;
}

function buildKeypad(name, options, defaultValue, opts = {}) {
  const { tone = '', compact = false, labelFn = v => v } = opts;
  const compactCls = compact ? ' compact' : '';
  const toneAttr = tone ? ` data-tone="${tone}"` : '';
  return `<div class="keypad${compactCls}"${toneAttr}>` +
    options.map((v, idx) => {
      // Index-based id avoids collisions when option values share characters
      // after sanitization (e.g. -1 and 1 both collapse to "1").
      const id = `${name}_o${idx}`;
      const checked = String(v) === String(defaultValue) ? ' checked' : '';
      return `<input type="radio" id="${id}" name="${name}" value="${v}"${checked}>` +
             `<label for="${id}">${labelFn(v)}</label>`;
    }).join('') +
    '</div>';
}

function buildTogglePill(idOrClass, label, checked, tone = '', controls = '') {
  const isClass = idOrClass.startsWith('.');
  const attr = isClass ? `class="${idOrClass.slice(1)}"` : `id="${idOrClass}"`;
  const toneCls = tone ? ` tone-${tone}` : '';
  const ctrlAttr = controls ? ` data-controls="${controls}"` : '';
  return `<label class="toggle-pill${toneCls}" data-checked="${checked ? 'true' : 'false'}"${ctrlAttr}>
    <input type="checkbox" ${attr} ${checked ? 'checked' : ''}>${label}
  </label>`;
}

// Delegated handler: any toggle-pill checkbox change updates its pill's
// visual state and any sub-control it controls.
function onPillChange(e) {
  const input = e.target;
  if (!(input.matches && input.matches('.toggle-pill input[type="checkbox"]'))) return;
  const pill = input.closest('.toggle-pill');
  if (!pill) return;
  pill.dataset.checked = String(input.checked);
  const subId = pill.dataset.controls;
  if (subId) {
    const sub = document.getElementById(subId);
    if (sub) sub.dataset.hidden = String(!input.checked);
  }
}

// ───────────────────────────────────────────────────────────────────
//  Dice input builder
// ───────────────────────────────────────────────────────────────────

function buildDiceInput(cls, value, chips, label, labelExtras = '') {
  const safeId = `${cls}_${Math.random().toString(36).slice(2, 8)}`;
  const labelHtml = labelExtras
    ? `<div class="field-label dice-input-labelrow"><span>${label}</span>${labelExtras}</div>`
    : `<label class="field-label">${label}</label>`;
  return `
    <div class="dice-input" data-dice-input="${safeId}">
      ${labelHtml}
      <div class="dice-input-row">
        <button type="button" class="dice-step-btn" onclick="diceStep(this, -1)" aria-label="Decrease ${label}" tabindex="-1">−</button>
        <input type="text" class="dice-input-field ${cls}" value="${value}"
               oninput="onDiceInputChange(this)" autocomplete="off"
               inputmode="text" spellcheck="false">
        <button type="button" class="dice-step-btn" onclick="diceStep(this, 1)" aria-label="Increase ${label}" tabindex="-1">+</button>
      </div>
      <div class="dice-input-chips">
        ${chips.map(c => `<button type="button" class="dice-chip" data-value="${c}" onclick="setDiceValue(this, '${c}')">${c}</button>`).join('')}
      </div>
      <div class="dice-meta" data-dice-meta>${describeDice(value)}</div>
    </div>
  `;
}

function buildModelsFiring(value) {
  const v = Math.max(1, parseInt(value, 10) || 1);
  return `<span class="models-firing" title="How many models in this unit are firing this weapon. Each model rolls its own Attacks dice.">
    <span class="mf-x">×</span>
    <button type="button" class="mf-btn" onclick="adjustModels(this,-1)" aria-label="Fewer models">−</button>
    <input type="number" class="mf-input w-models" min="1" max="30" value="${v}" oninput="onModelsInputChange(this)">
    <button type="button" class="mf-btn" onclick="adjustModels(this,1)" aria-label="More models">+</button>
    <span class="mf-label">models</span>
  </span>`;
}

function describeDice(expr) {
  if (!isValidDiceExpr(expr)) return 'Invalid — try 6, D6, 2D6, D6+1';
  const avg = avgDiceExpr(expr);
  const p = parseDice(expr);
  if (p.count === 0) return `fixed ${p.mod}`;
  return `avg ${formatAvg(avg)} (random)`;
}

// Attacks meta is multiplied by models firing — each model rolls
// independently, so total expected attacks = models × avg(expr).
function describeAttacks(expr, models) {
  if (!isValidDiceExpr(expr)) return 'Invalid — try 6, D6, 2D6, D6+1';
  const avg = avgDiceExpr(expr);
  const p = parseDice(expr);
  const total = avg * models;
  if (models <= 1) {
    if (p.count === 0) return `fixed ${p.mod}`;
    return `avg ${formatAvg(avg)} (random)`;
  }
  if (p.count === 0) return `${models} × ${p.mod} = ${total}`;
  return `${models} × ${expr} → avg ${formatAvg(total)}`;
}

// Up/down counter on a dice input. For a plain number we nudge the value
// (clamped ≥ 1); for a dice expression we adjust only the flat +N modifier,
// leaving the dice intact (e.g. D6+1 → D6+2, D6 → D6−1). Invalid expressions
// are left untouched. Re-uses onDiceInputChange to refresh meta + chips.
function diceStep(btn, delta) {
  const row = btn.closest('.dice-input-row');
  const input = row && row.querySelector('.dice-input-field');
  if (!input) return;
  const p = parseDice(input.value);
  if (!p) return;
  if (p.count === 0) {
    input.value = String(Math.max(1, Math.min(99, p.mod + delta)));
  } else {
    const mod = Math.max(-9, Math.min(30, p.mod + delta));
    const head = `${p.count === 1 ? '' : p.count}D${p.sides}`;
    input.value = mod > 0 ? `${head}+${mod}` : mod < 0 ? `${head}${mod}` : head;
  }
  onDiceInputChange(input);
}

function setDiceValue(chipBtn, value) {
  const wrap = chipBtn.closest('.dice-input');
  const input = wrap.querySelector('.dice-input-field');
  input.value = value;
  onDiceInputChange(input);
  input.focus();
}

function onDiceInputChange(input) {
  const wrap = input.closest('.dice-input');
  if (!wrap) return;
  const valid = isValidDiceExpr(input.value);
  input.dataset.invalid = String(!valid);
  const meta = wrap.querySelector('[data-dice-meta]');
  if (meta) {
    const isAttacks = input.classList.contains('w-attacks');
    if (isAttacks) {
      const card = input.closest('.weapon-card');
      const models = Math.max(1, parseInt(valOf(card && card.querySelector('.w-models')), 10) || 1);
      meta.textContent = describeAttacks(input.value, models);
    } else {
      meta.textContent = describeDice(input.value);
    }
  }
  // Active chip highlight
  wrap.querySelectorAll('.dice-chip').forEach(c => {
    c.dataset.active = String(c.dataset.value.toUpperCase() === String(input.value).trim().toUpperCase());
  });
}

function onModelsInputChange(input) {
  let v = parseInt(input.value, 10);
  if (!Number.isFinite(v)) v = 1;
  v = Math.max(1, Math.min(30, v));
  if (String(v) !== input.value) input.value = String(v);
  // Refresh the Attacks meta in this card to reflect new models count.
  const card = input.closest('.weapon-card');
  const attacksInput = card && card.querySelector('.w-attacks');
  if (attacksInput) onDiceInputChange(attacksInput);
}

function adjustModels(btn, delta) {
  const wrap = btn.closest('.models-firing');
  const input = wrap && wrap.querySelector('.mf-input');
  if (!input) return;
  const next = (parseInt(input.value, 10) || 1) + delta;
  input.value = String(Math.max(1, Math.min(30, next)));
  onModelsInputChange(input);
}

// ───────────────────────────────────────────────────────────────────
//  Stepper
// ───────────────────────────────────────────────────────────────────

function buildStepper(cls, value, min = 1, max = 30) {
  return `
    <div class="stepper">
      <button type="button" onclick="stepperAdjust(this, -1, ${min}, ${max})">−</button>
      <input type="number" class="${cls}" value="${value}" min="${min}" max="${max}">
      <button type="button" onclick="stepperAdjust(this, 1, ${min}, ${max})">+</button>
    </div>
  `;
}

function stepperAdjust(btn, delta, min, max) {
  const input = btn.parentElement.querySelector('input');
  let v = parseInt(input.value, 10) || min;
  v = Math.max(min, Math.min(max, v + delta));
  input.value = v;
  input.dispatchEvent(new Event('change'));
}

// ───────────────────────────────────────────────────────────────────
//  Weapon cards
// ───────────────────────────────────────────────────────────────────

let weaponCounter = 0;

function addWeaponCard(state = {}) {
  weaponCounter++;
  const id = weaponCounter;
  const s = Object.assign({
    name: `Weapon ${id}`,
    attacks: '4',
    models: 1,
    hitTarget: 3,
    strength: 4,
    ap: 0,
    damage: '1',
    woundOverride: 4,
    hitReRoll: 'none',
    hitModifier: 0,
    torrent: false,
    lethal: false,
    sustainedExpr: '0',
    critHitThreshold: 6,
    woundReRoll: 'none',
    woundModifier: 0,
    twinLinked: false,
    devastating: false,
    critWoundThreshold: 6,
    hasAnti: false,
    lance: false,
    charging: false,
    melta: 0,
    inMeltaRange: false,
    blast: false,
    ignoresCover: false
  }, migrateLegacyWeapon(state));

  const html = `
    <div class="weapon-card" id="weaponCard_${id}" data-weapon-id="${id}">
      <div class="weapon-header">
        <input type="text" class="weapon-name-input w-name" value="${escapeHtml(s.name)}">
        <button class="weapon-action-btn clone" title="Duplicate weapon" onclick="cloneWeapon(${id})">⎘</button>
        <button class="weapon-action-btn" title="Remove weapon" onclick="this.closest('.weapon-card').remove()">×</button>
      </div>

      <div>${buildDiceInput('w-attacks', s.attacks, ATTACK_CHIPS, 'Attacks', buildModelsFiring(s.models))}</div>
      <div>${buildDiceInput('w-damage', s.damage, DAMAGE_CHIPS, 'Damage')}</div>

      <div>
        <label class="field-label">Hit (BS)</label>
        ${buildKeypad(`bs_${id}`, HIT_TARGETS, s.hitTarget, { tone: 'blue', labelFn: v => `${v}+` })}
      </div>

      <div class="grid-2">
        <div>
          <label class="field-label">Strength</label>
          ${buildStepper('w-strength', s.strength, 1, 30)}
        </div>
        <div class="w-wound-override">
          <label class="field-label">Wound (raw mode)</label>
          ${buildKeypad(`wo_${id}`, HIT_TARGETS, s.woundOverride, { tone: 'rose', compact: true, labelFn: v => `${v}+` })}
        </div>
      </div>

      <div>
        <label class="field-label">AP</label>
        ${buildKeypad(`ap_${id}`, AP_VALUES, s.ap, { compact: true })}
      </div>

      <div class="modifier-section" data-collapsible data-collapsed="false">
        <div class="modifier-section-header" onclick="toggleSection(this)">
          <span class="modifier-section-title hit">Hit Modifiers</span>
          <span class="section-chevron">▾</span>
        </div>
        <div class="modifier-section-body">
          <div class="grid-2">
            <div>
              <label class="field-label">Re-rolls</label>
              ${buildKeypad(`hreroll_${id}`, ['none','ones','full'], s.hitReRoll, { compact: true, tone: 'blue', labelFn: v => v === 'none' ? '—' : v === 'ones' ? '1s' : 'All' })}
            </div>
            <div>
              <label class="field-label">±1 to Hit</label>
              ${buildKeypad(`hmod_${id}`, HIT_MOD_OPTS, s.hitModifier, { compact: true, tone: 'blue', labelFn: v => v > 0 ? '+1' : v < 0 ? '−1' : '0' })}
            </div>
          </div>
          <div class="toggle-row">
            ${buildTogglePill('.w-torrent', 'TORRENT', s.torrent, 'blue')}
            ${buildTogglePill('.w-lethal', 'LETHAL HITS', s.lethal, 'blue')}
          </div>
          <div>
            <label class="field-label">Sustained Hits</label>
            ${buildKeypad(`sus_${id}`, SUSTAINED_OPTS, s.sustainedExpr, { compact: true, tone: 'blue', labelFn: v => v === '0' ? 'Off' : v })}
          </div>
          <div>
            <label class="field-label">Critical Hit On</label>
            ${buildKeypad(`crith_${id}`, CRIT_HIT_THRESHOLDS, s.critHitThreshold, { compact: true, tone: 'blue', labelFn: v => `${v}+` })}
          </div>
        </div>
      </div>

      <div class="modifier-section" data-collapsible data-collapsed="false">
        <div class="modifier-section-header" onclick="toggleSection(this)">
          <span class="modifier-section-title wound">Wound Modifiers</span>
          <span class="section-chevron">▾</span>
        </div>
        <div class="modifier-section-body">
          <div class="grid-2">
            <div>
              <label class="field-label">Re-rolls</label>
              ${buildKeypad(`wreroll_${id}`, ['none','ones','full'], s.woundReRoll, { compact: true, tone: 'purple', labelFn: v => v === 'none' ? '—' : v === 'ones' ? '1s' : 'All' })}
            </div>
            <div>
              <label class="field-label">±1 to Wound</label>
              ${buildKeypad(`wmod_${id}`, HIT_MOD_OPTS, s.woundModifier, { compact: true, tone: 'purple', labelFn: v => v > 0 ? '+1' : v < 0 ? '−1' : '0' })}
            </div>
          </div>
          <div class="toggle-row">
            ${buildTogglePill('.w-twinLinked', 'TWIN-LINKED', s.twinLinked, 'purple')}
            ${buildTogglePill('.w-devastating', 'DEVASTATING', s.devastating, 'purple')}
            ${buildTogglePill('.w-hasAnti', 'ANTI-X+', s.hasAnti, 'purple', `antiSub_${id}`)}
          </div>
          <div class="sub-control" id="antiSub_${id}" data-hidden="${!s.hasAnti}">
            <span class="sub-control-label">Critical wound on</span>
            ${buildKeypad(`antithr_${id}`, CRIT_WOUND_THRESHOLDS, s.critWoundThreshold, { compact: true, tone: 'purple', labelFn: v => `${v}+` })}
          </div>
        </div>
      </div>

      <div class="modifier-section" data-collapsible data-collapsed="true">
        <div class="modifier-section-header" onclick="toggleSection(this)">
          <span class="modifier-section-title special">Special Rules</span>
          <span class="section-chevron">▾</span>
        </div>
        <div class="modifier-section-body">
          <div class="toggle-row">
            ${buildTogglePill('.w-lance', 'LANCE', s.lance, 'emerald', `lanceSub_${id}`)}
            ${buildTogglePill('.w-hasMelta', 'MELTA', s.melta > 0, 'emerald', `meltaSub_${id}`)}
            ${buildTogglePill('.w-blast', 'BLAST', s.blast, 'emerald')}
            ${buildTogglePill('.w-ignoresCover', 'IGNORES COVER', s.ignoresCover, 'emerald')}
          </div>
          <div class="sub-control" id="lanceSub_${id}" data-hidden="${!s.lance}">
            ${buildTogglePill('.w-charging', 'On the charge?', s.charging, 'emerald')}
          </div>
          <div class="sub-control" id="meltaSub_${id}" data-hidden="${s.melta <= 0}">
            <span class="sub-control-label">+Dmg in range</span>
            <div style="flex:0 0 110px">${buildStepper('w-meltaVal', Math.max(1, s.melta), 1, 6)}</div>
            ${buildTogglePill('.w-inMeltaRange', 'In range', s.inMeltaRange, 'emerald')}
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('weaponsContainer').insertAdjacentHTML('beforeend', html);

  // Initialize dice chip highlights for the just-added card
  const card = document.getElementById(`weaponCard_${id}`);
  card.querySelectorAll('.dice-input-field').forEach(onDiceInputChange);

  syncWeaponInputFields();
  return card;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function migrateLegacyWeapon(state) {
  // Accept new state or old saved-roster shape and coerce to current shape.
  if (!state || Object.keys(state).length === 0) return {};
  const m = state.modifiers || {};
  const result = { name: state.name };
  if ('attacks' in state) result.attacks = String(state.attacks);
  if ('models' in state) result.models = Math.max(1, parseInt(state.models, 10) || 1);
  if ('hitTarget' in state) result.hitTarget = state.hitTarget;
  if ('strength' in state) result.strength = state.strength;
  if ('ap' in state) result.ap = state.ap;
  if ('damage' in state) result.damage = String(state.damage);
  if ('explicitWoundTarget' in m) result.woundOverride = m.explicitWoundTarget;
  if ('hitReRoll' in m) result.hitReRoll = m.hitReRoll;
  if ('hitModifier' in m) result.hitModifier = m.hitModifier;
  if ('torrent' in m) result.torrent = m.torrent;
  if ('lethal' in m) result.lethal = m.lethal;
  if ('sustained' in m) result.sustainedExpr = String(m.sustained);
  if ('sustainedExpr' in m) result.sustainedExpr = m.sustainedExpr;
  if ('hasCustomCritHit' in m && m.hasCustomCritHit) result.critHitThreshold = m.critHit || 6;
  if ('critHitThreshold' in m) result.critHitThreshold = m.critHitThreshold;
  if ('woundReRoll' in m) result.woundReRoll = m.woundReRoll;
  if ('woundModifier' in m) result.woundModifier = m.woundModifier;
  if ('twinLinked' in m) result.twinLinked = m.twinLinked;
  if ('devastating' in m) result.devastating = m.devastating;
  if ('hasAnti' in m) result.hasAnti = m.hasAnti;
  if ('critWound' in m && m.hasAnti) result.critWoundThreshold = m.critWound;
  if ('critWoundThreshold' in m) result.critWoundThreshold = m.critWoundThreshold;
  if ('lance' in m) result.lance = m.lance;
  if ('charging' in m) result.charging = m.charging;
  if ('melta' in m) result.melta = m.melta;
  if ('inMeltaRange' in m) result.inMeltaRange = m.inMeltaRange;
  if ('blast' in m) result.blast = m.blast;
  if ('ignoresCover' in m) result.ignoresCover = m.ignoresCover;
  return result;
}

function readWeaponState(card) {
  const id = card.dataset.weaponId;
  return {
    name: card.querySelector('.w-name').value || `Weapon ${id}`,
    attacks: card.querySelector('.w-attacks').value,
    models: Math.max(1, parseInt(valOf(card.querySelector('.w-models')), 10) || 1),
    damage: card.querySelector('.w-damage').value,
    hitTarget: parseInt(getCheckedKeypad(`bs_${id}`) || '3', 10),
    strength: parseInt(card.querySelector('.w-strength').value, 10) || 4,
    ap: parseInt(getCheckedKeypad(`ap_${id}`) || '0', 10),
    woundOverride: parseInt(getCheckedKeypad(`wo_${id}`) || '4', 10),
    hitReRoll: getCheckedKeypad(`hreroll_${id}`) || 'none',
    hitModifier: parseInt(getCheckedKeypad(`hmod_${id}`) || '0', 10),
    torrent: card.querySelector('.w-torrent').checked,
    lethal: card.querySelector('.w-lethal').checked,
    sustainedExpr: getCheckedKeypad(`sus_${id}`) || '0',
    critHitThreshold: parseInt(getCheckedKeypad(`crith_${id}`) || '6', 10),
    woundReRoll: getCheckedKeypad(`wreroll_${id}`) || 'none',
    woundModifier: parseInt(getCheckedKeypad(`wmod_${id}`) || '0', 10),
    twinLinked: card.querySelector('.w-twinLinked').checked,
    devastating: card.querySelector('.w-devastating').checked,
    hasAnti: card.querySelector('.w-hasAnti').checked,
    critWoundThreshold: card.querySelector('.w-hasAnti').checked
      ? parseInt(getCheckedKeypad(`antithr_${id}`) || '6', 10)
      : 6,
    lance: card.querySelector('.w-lance').checked,
    charging: card.querySelector('.w-charging').checked,
    meltaActive: card.querySelector('.w-hasMelta').checked,
    melta: card.querySelector('.w-hasMelta').checked ? (parseInt(card.querySelector('.w-meltaVal').value, 10) || 0) : 0,
    inMeltaRange: card.querySelector('.w-inMeltaRange').checked,
    blast: card.querySelector('.w-blast').checked,
    ignoresCover: card.querySelector('.w-ignoresCover').checked
  };
}

function cloneWeapon(id) {
  const card = document.getElementById(`weaponCard_${id}`);
  const s = readWeaponState(card);
  s.name = s.name + ' (copy)';
  addWeaponCard(toLegacyWeaponShape(s));
  toast('Weapon duplicated', 'success');
}

function syncWeaponInputFields() {
  const targetMode = document.getElementById('targetUnitSelect').value;
  const raw = targetMode === 'none';
  document.querySelectorAll('.w-wound-override').forEach(el => el.hidden = !raw);
}

// ───────────────────────────────────────────────────────────────────
//  Roster save / load
// ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'wh40k_rosters';

function toLegacyWeaponShape(s) {
  return {
    name: s.name,
    attacks: s.attacks,
    models: s.models,
    hitTarget: s.hitTarget,
    strength: s.strength,
    ap: s.ap,
    damage: s.damage,
    modifiers: {
      explicitWoundTarget: s.woundOverride,
      hitReRoll: s.hitReRoll, hitModifier: s.hitModifier,
      torrent: s.torrent, lethal: s.lethal,
      sustainedExpr: s.sustainedExpr,
      critHitThreshold: s.critHitThreshold,
      woundReRoll: s.woundReRoll, woundModifier: s.woundModifier,
      twinLinked: s.twinLinked, devastating: s.devastating,
      hasAnti: s.hasAnti, critWoundThreshold: s.critWoundThreshold,
      lance: s.lance, charging: s.charging,
      melta: s.melta, inMeltaRange: s.inMeltaRange,
      blast: s.blast, ignoresCover: s.ignoresCover
    }
  };
}

function saveCurrentRoster() {
  const rosterName = document.getElementById('rosterNameInput').value.trim();
  if (!rosterName) return toast('Name your roster before saving', 'warn');
  const cards = document.querySelectorAll('.weapon-card');
  if (!cards.length) return toast('Add at least one weapon first', 'warn');

  const rosterData = [...cards].map(c => toLegacyWeaponShape(readWeaponState(c)));
  const library = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  library[rosterName] = rosterData;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  updateRosterDropdown();
  document.getElementById('savedRostersSelect').value = rosterName;
  toast(`Saved "${rosterName}"`, 'success');
}

function loadSelectedRoster() {
  const rosterName = document.getElementById('savedRostersSelect').value;
  const library = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  if (!library[rosterName]) return;
  document.getElementById('weaponsContainer').innerHTML = '';
  weaponCounter = 0;
  library[rosterName].forEach(w => addWeaponCard(w));
  document.getElementById('rosterNameInput').value = rosterName;
  toast(`Loaded "${rosterName}"`);
}

function deleteCurrentRoster() {
  const rosterName = document.getElementById('savedRostersSelect').value;
  if (!rosterName) return toast('No roster selected', 'warn');
  if (!confirm(`Delete roster "${rosterName}"?`)) return;
  const library = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  delete library[rosterName];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  updateRosterDropdown();
  toast(`Deleted "${rosterName}"`);
}

function updateRosterDropdown() {
  const select = document.getElementById('savedRostersSelect');
  select.innerHTML = '<option value="" disabled selected>— Load saved roster —</option>';
  const library = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  Object.keys(library).sort().forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    select.appendChild(opt);
  });
}

function clearAllWeapons() {
  if (!confirm('Remove all weapons from this roster?')) return;
  document.getElementById('weaponsContainer').innerHTML = '';
  weaponCounter = 0;
  toast('Cleared all weapons');
}

// ───────────────────────────────────────────────────────────────────
//  Pipeline engine
// ───────────────────────────────────────────────────────────────────

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function calculateWoundTarget(s, t) {
  if (s >= t * 2) return 2;
  if (s > t) return 3;
  if (s === t) return 4;
  if (s <= t / 2) return 6;
  return 5;
}

function calculateSaveTarget(target, ap, hasCover, ignoresCover) {
  let sv = target.sv - ap;  // ap negative -> sv increases
  if (hasCover && !ignoresCover && sv > 3) {
    sv = Math.max(3, sv - 1);
  }
  if (target.inv > 0) return Math.min(sv, target.inv);
  return sv;
}

function applyDamageReduction(rawDamage, target) {
  let d = rawDamage;
  if (target.halveDamage) d = Math.ceil(d / 2);
  if (target.minusOneDamage) d = d - 1;
  return Math.max(1, d);
}

function resolveWeaponRound(w, ctx, log) {
  const { target, hasTarget, modelState } = ctx;

  // Modifier composition (cap ±1 cumulatively)
  const hitMod = clamp(w.hitModifier + (target.stealthHit ? -1 : 0), -1, 1);
  const woundMod = clamp(
    w.woundModifier + (w.lance && w.charging ? 1 : 0) + (target.minusOneWound ? -1 : 0),
    -1, 1
  );

  // Each model firing the weapon rolls its own Attacks expression
  // (Core Rules: characteristics are rolled per-model when random). [BLAST]
  // adds its bonus to each firing model's Attacks roll.
  const modelsFiring = Math.max(1, w.models || 1);
  const blastBonus = (w.blast && hasTarget && target.modelCount)
    ? Math.floor(target.modelCount / 5) : 0;
  let attacks = 0;
  for (let m = 0; m < modelsFiring; m++) {
    attacks += rollDiceExpr(w.attacks) + blastBonus;
  }
  if (attacks <= 0) return null;

  // Per Fast Dice Rolling rules, random damage must be rolled per attack
  // (overkill is lost, so the order of allocation matters). Resolved
  // per-bundle below; this helper centralizes the roll + Melta bonus.
  const rollAttackDamage = () => {
    let d = rollDiceExpr(w.damage);
    if (w.melta > 0 && w.inMeltaRange) d += w.melta;
    return d;
  };

  // ─── HIT PHASE ─────────────────────────────────────────────────
  let hits = 0;
  let lethalAutoWounds = 0;
  let sustainedBonusHits = 0;
  let critHits = 0;

  if (w.torrent) {
    hits = attacks;
  } else {
    const wouldFailHit = (r) => {
      if (r === 6 || r >= w.critHitThreshold) return false;
      if (r === 1) return true;
      return (r + hitMod) < w.hitTarget;
    };
    for (let i = 0; i < attacks; i++) {
      let roll = rollD6();
      if (w.hitReRoll === 'ones' && roll === 1) roll = rollD6();
      else if (w.hitReRoll === 'full' && wouldFailHit(roll)) roll = rollD6();

      if (roll === 1) continue;
      const isCrit = (roll === 6) || (roll >= w.critHitThreshold);
      if (isCrit) {
        critHits++;
        if (w.lethal) lethalAutoWounds++;
        else hits++;
        if (w.sustainedExpr && w.sustainedExpr !== '0') {
          sustainedBonusHits += rollDiceExpr(w.sustainedExpr);
        }
      } else {
        if ((roll + hitMod) >= w.hitTarget) hits++;
      }
    }
  }

  // ─── WOUND PHASE ───────────────────────────────────────────────
  const woundPool = hits + sustainedBonusHits;
  const woundTarget = hasTarget ? calculateWoundTarget(w.strength, target.t) : w.woundOverride;

  let normalWounds = 0;
  let devastatingWounds = 0;

  const wouldFailWound = (r) => {
    if (r === 6 || r >= w.critWoundThreshold) return false;
    if (r === 1) return true;
    return (r + woundMod) < woundTarget;
  };
  for (let i = 0; i < woundPool; i++) {
    let roll = rollD6();
    if (w.twinLinked && wouldFailWound(roll)) roll = rollD6();
    else if (w.woundReRoll === 'ones' && roll === 1) roll = rollD6();
    else if (w.woundReRoll === 'full' && wouldFailWound(roll)) roll = rollD6();

    if (roll === 1) continue;
    const isCrit = (roll === 6) || (roll >= w.critWoundThreshold);
    if (isCrit) {
      if (w.devastating) devastatingWounds++;
      else normalWounds++;
    } else {
      if ((roll + woundMod) >= woundTarget) normalWounds++;
    }
  }

  const result = {
    attacks, hits, critHits, lethalAutoWounds, sustainedBonusHits,
    normalWounds, devastatingWounds,
    failedSaves: 0, totalDamage: 0, modelsKilled: 0,
    woundTarget, savesAttempted: 0
  };

  if (!hasTarget) {
    log.push(`${w.name}: ${attacks}A → ${hits} hits (+${lethalAutoWounds} lethal, +${sustainedBonusHits} sustained) → ${normalWounds} wounds (+${devastatingWounds} dev)`);
    return result;
  }

  // ─── SAVE PHASE ────────────────────────────────────────────────
  const saveTarget = calculateSaveTarget(target, w.ap, target.cover, w.ignoresCover);
  const saveAttempts = normalWounds + lethalAutoWounds;
  result.savesAttempted = saveAttempts;

  const damageBundles = [];
  for (let i = 0; i < saveAttempts; i++) {
    if (saveTarget > 6) {
      result.failedSaves++;
      damageBundles.push({ damage: rollAttackDamage(), mortal: false });
    } else {
      const r = rollD6();
      // Unmodified 1 always fails per Core Rules; otherwise compare to target.
      if (r === 1 || r < saveTarget) {
        result.failedSaves++;
        damageBundles.push({ damage: rollAttackDamage(), mortal: false });
      }
    }
  }
  for (let i = 0; i < devastatingWounds; i++) {
    damageBundles.push({ damage: rollAttackDamage(), mortal: true });
  }

  // ─── DAMAGE ALLOCATION ────────────────────────────────────────
  for (const bundle of damageBundles) {
    if (modelState.unitWipedOut) break;
    const dmg = bundle.mortal ? bundle.damage : applyDamageReduction(bundle.damage, target);
    for (let pt = 0; pt < dmg; pt++) {
      if (modelState.unitWipedOut) break;
      if (target.fnp > 0 && rollD6() >= target.fnp) continue;
      modelState.currentWounds -= 1;
      result.totalDamage += 1;
      if (modelState.currentWounds <= 0) {
        modelState.aliveCount -= 1;
        result.modelsKilled += 1;
        if (modelState.aliveCount <= 0) {
          modelState.unitWipedOut = true;
          break;
        }
        modelState.currentWounds = target.w;
        break; // remaining damage from this attack is lost (no spill-over)
      }
    }
  }

  log.push(`${w.name}: ${attacks}A → ${hits + lethalAutoWounds + sustainedBonusHits} hits (crit ${critHits}) → ${normalWounds + lethalAutoWounds} std + ${devastatingWounds} dev → ${result.failedSaves} failed saves → ${result.totalDamage} dmg`);
  return result;
}

// ───────────────────────────────────────────────────────────────────
//  Engagement state (persists across salvos)
// ───────────────────────────────────────────────────────────────────

// One engagement = one unit being shot at by one roster, across N salvos.
// Persists between executeSalvo() calls so each click advances damage on
// the same target rather than resetting. Cleared by resetEngagement() or
// by switching to a different target unit.
let engagement = null;

function currentTargetKey() {
  const key = valOf(document.getElementById('targetUnitSelect')) || 'none';
  const size = valOf(document.getElementById('unitSizeSelect')) || '';
  return `${key}:${size}`;
}

function makeAggregateSlot(w) {
  return {
    name: w.name, ap: w.ap, damage: w.damage,
    attacks: 0, hits: 0, lethal: 0, sustained: 0, critHits: 0,
    normalWounds: 0, devWounds: 0, savesAttempted: 0, failedSaves: 0,
    totalDamage: 0, modelsKilled: 0, salvosActive: 0
  };
}

function newEngagement(target, hasTarget) {
  return {
    target,
    hasTarget,
    targetKey: currentTargetKey(),
    modelState: {
      currentWounds: hasTarget ? target.w : 0,
      aliveCount: hasTarget ? target.modelCount : 0,
      unitWipedOut: false
    },
    aggregateByWeapon: new Map(),   // weaponCardId -> aggregate slot
    salvosFired: 0,
    salvoWipedIn: 0,
    log: []
  };
}

function resetEngagement() {
  const wasActive = engagement && engagement.salvosFired > 0;
  engagement = null;
  document.getElementById('resultsContainer').hidden = true;
  if (wasActive) toast('Engagement reset');
}

function executeSalvo() {
  const cards = document.querySelectorAll('.weapon-card');
  if (!cards.length) return toast('Add at least one weapon first', 'warn');

  // Validate all dice expressions
  for (const c of cards) {
    if (!isValidDiceExpr(c.querySelector('.w-attacks').value) ||
        !isValidDiceExpr(c.querySelector('.w-damage').value)) {
      return toast('One or more weapons has an invalid dice expression', 'error');
    }
  }

  const weapons = [...cards].map(c => Object.assign({}, readWeaponState(c), {
    _cardId: c.dataset.weaponId
  }));
  const { hasTarget, target } = readTargetState();

  // Start a fresh engagement on first salvo, or if the target unit changed.
  // Defensive modifier tweaks (cover, FNP, etc.) do NOT reset — they apply
  // to the next salvo, like a tabletop player activating a stratagem.
  const targetKeyNow = currentTargetKey();
  const targetUnitChanged = engagement
    && (engagement.targetKey !== targetKeyNow || engagement.hasTarget !== hasTarget);
  if (!engagement || targetUnitChanged) {
    if (targetUnitChanged) toast('New target — engagement reset', 'warn');
    engagement = newEngagement(target, hasTarget);
  } else {
    // Update target snapshot so live modifier changes take effect.
    engagement.target = target;
    engagement.hasTarget = hasTarget;
  }

  if (engagement.modelState.unitWipedOut) {
    toast('Target already destroyed — press Reset for a fresh unit', 'warn');
    renderEngagement();
    return;
  }

  engagement.salvosFired += 1;
  engagement.log.push(`<span class="round">— Salvo ${engagement.salvosFired} —</span>`);

  weapons.forEach((w) => {
    if (engagement.modelState.unitWipedOut) return;

    let agg = engagement.aggregateByWeapon.get(w._cardId);
    if (!agg) {
      agg = makeAggregateSlot(w);
      engagement.aggregateByWeapon.set(w._cardId, agg);
    } else {
      // Refresh display fields in case user edited them mid-engagement.
      agg.name = w.name; agg.ap = w.ap; agg.damage = w.damage;
    }

    const result = resolveWeaponRound(
      w,
      { target: engagement.target, hasTarget: engagement.hasTarget, modelState: engagement.modelState },
      engagement.log
    );
    if (!result) return;

    agg.attacks       += result.attacks;
    agg.hits          += result.hits;
    agg.lethal        += result.lethalAutoWounds;
    agg.sustained     += result.sustainedBonusHits;
    agg.critHits      += result.critHits;
    agg.normalWounds  += result.normalWounds;
    agg.devWounds     += result.devastatingWounds;
    agg.savesAttempted += result.savesAttempted;
    agg.failedSaves   += result.failedSaves;
    agg.totalDamage   += result.totalDamage;
    agg.modelsKilled  += result.modelsKilled;
    agg.salvosActive  += 1;
  });

  if (engagement.modelState.unitWipedOut && engagement.salvoWipedIn === 0) {
    engagement.salvoWipedIn = engagement.salvosFired;
  }

  renderEngagement();
}

// ───────────────────────────────────────────────────────────────────
//  Engagement rendering
// ───────────────────────────────────────────────────────────────────

function renderEngagement() {
  if (!engagement) return;
  const { aggregateByWeapon, hasTarget, target, modelState, salvosFired, salvoWipedIn, log } = engagement;
  document.getElementById('resultsContainer').hidden = false;

  // ── Target status dashboard ──
  const dashboard = document.getElementById('targetStatusDashboard');
  const salvoLabel = `${salvosFired} salvo${salvosFired !== 1 ? 's' : ''} fired`;

  if (hasTarget) {
    const wiped = modelState.unitWipedOut;
    const cardCls = wiped ? 'destroyed' : 'survived';
    const title = wiped ? 'Target Destroyed' : 'Engagement Active';
    const body = wiped
      ? `Wiped out in <strong>Salvo ${salvoWipedIn}</strong> · ${target.modelCount} / ${target.modelCount} models down · ${salvoLabel}`
      : `<strong>${modelState.aliveCount} / ${target.modelCount}</strong> models · ${modelState.currentWounds} HP on lead model · ${salvoLabel}`;
    dashboard.innerHTML = `
      <div class="target-status-card ${cardCls}">
        <h3>${escapeHtml(target.name)} — ${title}</h3>
        <p class="small">${body}</p>
      </div>`;
  } else {
    dashboard.innerHTML = `
      <div class="target-status-card survived">
        <h3>Raw Mode</h3>
        <p class="small">No target — cumulative hit/wound totals across ${salvoLabel}.</p>
      </div>`;
  }

  // ── Per-weapon breakdown (only weapons still present in the roster) ──
  const blocks = document.getElementById('allocationBlocksContainer');
  blocks.innerHTML = '';
  const currentWeaponIds = new Set(
    [...document.querySelectorAll('.weapon-card')].map(c => c.dataset.weaponId)
  );

  let anyOutput = false;
  aggregateByWeapon.forEach((a, weaponId) => {
    if (!currentWeaponIds.has(weaponId)) return;
    const totalWoundSuccesses = a.normalWounds + a.lethal + a.devWounds;
    if (totalWoundSuccesses === 0 && a.totalDamage === 0 && a.attacks === 0) return;
    anyOutput = true;

    const div = (n, d) => d > 0 ? (n / d * 100).toFixed(1) + '%' : '—';

    let html = `<div class="allocation-card">
      <div class="allocation-header">
        <span style="color:#fbbf24">${escapeHtml(a.name)}
          <span class="tiny mono muted" style="margin-left:.5rem">AP ${a.ap} · D ${a.damage}</span>
        </span>
        <span class="tiny mono muted">${a.attacks}A · ${a.hits + a.lethal + a.sustained}H · ${totalWoundSuccesses}W</span>
      </div>`;

    if (hasTarget) {
      html += `
        <div class="alloc-row headline ${a.totalDamage === 0 ? 'empty' : ''}">
          <span>Damage dealt</span>
          <span>${a.totalDamage}</span>
        </div>
        <div class="alloc-row"><span>Models killed</span><strong>${a.modelsKilled}</strong></div>
        <div class="alloc-row"><span>Saves forced</span><strong>${a.savesAttempted}</strong></div>
        <div class="alloc-row sub"><span>· from std wounds</span><span>${a.normalWounds}</span></div>
        <div class="alloc-row sub"><span>· from lethal hits</span><span class="mono" style="color:#34d399">${a.lethal}</span></div>
        <div class="alloc-row"><span>Saves failed</span><strong style="color:#fb7185">${a.failedSaves}</strong></div>`;
      if (a.devWounds > 0) {
        html += `<div class="alloc-row dev"><span>Devastating wounds (mortal)</span><strong>${a.devWounds}</strong></div>`;
      }
      if (a.sustained > 0) {
        html += `<div class="alloc-row sub"><span>· sustained bonus hits</span><span class="mono" style="color:#60a5fa">+${a.sustained}</span></div>`;
      }
      html += `<div class="alloc-row sub"><span>Conversion (A→failed save)</span><span>${div(a.failedSaves, a.attacks)}</span></div>`;
    } else {
      html += `
        <div class="alloc-row headline ${totalWoundSuccesses === 0 ? 'empty' : ''}">
          <span>Total wound successes</span>
          <span>${totalWoundSuccesses}</span>
        </div>
        <div class="alloc-row sub"><span>· standard wounds</span><span>${a.normalWounds}</span></div>
        <div class="alloc-row sub"><span>· from lethal hits</span><span class="mono" style="color:#34d399">${a.lethal}</span></div>`;
      if (a.devWounds > 0) {
        html += `<div class="alloc-row dev"><span>Devastating wounds</span><strong>${a.devWounds}</strong></div>`;
      }
      if (a.sustained > 0) {
        html += `<div class="alloc-row sub"><span>· sustained bonus hits</span><span class="mono" style="color:#60a5fa">+${a.sustained}</span></div>`;
      }
    }

    html += `</div>`;
    blocks.insertAdjacentHTML('beforeend', html);
  });

  if (!anyOutput) {
    blocks.innerHTML = `<div class="empty-state">No effective attacks yet — fire another salvo.</div>`;
  }

  // ── Combat log ──
  const logEl = document.getElementById('combatLog');
  logEl.innerHTML = log.map(l => `<div>${l}</div>`).join('');
  logEl.scrollTop = logEl.scrollHeight;

  document.getElementById('resultsContainer').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ───────────────────────────────────────────────────────────────────
//  Quick Roll
// ───────────────────────────────────────────────────────────────────

let quickRollState = { dice: [], target: null, sides: 6 };

function quickRoll() {
  const count = parseInt(document.getElementById('qrCount').value, 10) || 6;
  const sides = parseInt(getCheckedKeypad('qrDie') || '6', 10);
  const targetStr = getCheckedKeypad('qrTarget');
  const tgtNum = targetStr && targetStr !== 'none' ? parseInt(targetStr, 10) : null;

  quickRollState.dice = [];
  for (let i = 0; i < count; i++) quickRollState.dice.push(rollDN(sides));
  quickRollState.target = tgtNum;
  quickRollState.sides = sides;
  renderQuickRoll();
}

function quickRerollOnes() {
  if (!quickRollState.dice.length) return;
  const sides = quickRollState.sides;
  quickRollState.dice = quickRollState.dice.map(d => d === 1 ? rollDN(sides) : d);
  renderQuickRoll();
}

function quickRerollFailures() {
  if (!quickRollState.dice.length) return;
  // Allow setting target AFTER rolling — read current keypad
  const targetStr = getCheckedKeypad('qrTarget');
  if (!targetStr || targetStr === 'none') return toast('Set a success target first', 'warn');
  const target = parseInt(targetStr, 10);
  const sides = quickRollState.sides;
  quickRollState.dice = quickRollState.dice.map(d => (d < target && d !== sides) ? rollDN(sides) : d);
  quickRollState.target = target;
  renderQuickRoll();
}

// Re-roll every die that met the target — for effects that force re-rolling
// successful dice (e.g. an opponent making you re-roll passed saves).
function quickRerollSuccesses() {
  if (!quickRollState.dice.length) return;
  const targetStr = getCheckedKeypad('qrTarget');
  if (!targetStr || targetStr === 'none') return toast('Set a success target first', 'warn');
  const target = parseInt(targetStr, 10);
  const sides = quickRollState.sides;
  quickRollState.dice = quickRollState.dice.map(d => d >= target ? rollDN(sides) : d);
  quickRollState.target = target;
  renderQuickRoll();
}

function renderQuickRoll() {
  const tray = document.getElementById('qrTray');
  const summary = document.getElementById('qrSummary');
  const t = quickRollState.target;
  const sides = quickRollState.sides;

  if (!quickRollState.dice.length) {
    tray.innerHTML = `<div class="empty-state" style="width:100%">Tap "Roll" to throw dice.</div>`;
    summary.textContent = '';
    return;
  }

  // Crit highlighting is opt-in. When off, max-roll dice are treated as
  // ordinary successes (an unmodified max still always passes a target).
  const showCrits = isChecked('qrHighlightCrits');

  tray.innerHTML = quickRollState.dice.map(d => {
    let cls = 'die';
    if (showCrits && d === sides) cls += ' crit';
    else if (d === 1 && t !== null) cls += ' one';
    else if (t !== null) cls += (d >= t ? ' success' : ' fail');
    return `<div class="${cls}">${d}</div>`;
  }).join('');

  let crits = 0, hits = 0, fails = 0;
  quickRollState.dice.forEach(d => {
    if (d === sides) crits++;
    if (t !== null) {
      if (d >= t) hits++;
      else fails++;
    }
  });
  const critTxt = showCrits ? ` · <span style="color:#fbbf24"><strong>${crits}</strong> crits</span>` : '';
  if (t !== null) {
    summary.innerHTML = `<strong>${hits}</strong> hits${critTxt} · <span style="color:#fb7185">${fails} fails</span> · ${quickRollState.dice.length} dice`;
  } else {
    const maxTxt = showCrits ? ` · <span style="color:#fbbf24"><strong>${crits}</strong> max-rolls</span>` : '';
    summary.innerHTML = `<strong>Total:</strong> ${quickRollState.dice.reduce((s,n)=>s+n,0)}${maxTxt}`;
  }
}

// ───────────────────────────────────────────────────────────────────
//  Init
// ───────────────────────────────────────────────────────────────────

function populateTargetDropdown() {
  const sel = document.getElementById('targetUnitSelect');
  if (!sel) return;
  // Preserve the two fixed leading options (Raw mode) and the trailing
  // "— Custom unit —" option already in the HTML; inject presets between.
  const list = (window.SAMPLE_TARGETS || []);
  const customOpt = sel.querySelector('option[value="custom"]');
  for (const p of list) {
    const opt = document.createElement('option');
    opt.value = p.key;
    opt.textContent = p.label;
    sel.insertBefore(opt, customOpt);
  }
}

// ───────────────────────────────────────────────────────────────────
//  Battle Board — live VP / CP tracking + secondary objective deck
//
//  Single-player score keeping for active tabletop play. State persists
//  to localStorage so an accidental refresh mid-game doesn't wipe the
//  score. Card content comes from the swappable data/secondary-decks.js
//  layer (per CLAUDE.md §5 — the engine never hardcodes card content).
// ───────────────────────────────────────────────────────────────────

const BATTLE_KEY = 'wh40k_battleboard';
const BB_MIN = 0;
const BB_MAX = 99;   // generous, edition-agnostic — no hard VP cap baked in
const BB_HAND_SIZE = 2;
const BB_ROUNDS = 5; // a game is 5 battle rounds; each player takes a turn per round

// Round + turn are shared (one game timeline); each player owns their own
// scores, secondary deck, and drawn hand. The 2nd player is optional.
let battleState = defaultBattleState();

function defaultPlayer() {
  return { primary: 0, secondary: 0, cp: 0, deck: 'attacker', hand: [] };
}

function defaultBattleState() {
  return { round: 1, turn: 'p1', twoPlayer: false, players: [defaultPlayer(), defaultPlayer()] };
}

function clampScore(v) {
  v = parseInt(v, 10);
  if (!isFinite(v)) v = 0;
  return Math.max(BB_MIN, Math.min(BB_MAX, v));
}

function sanitizePlayer(p) {
  p = p || {};
  return {
    primary: clampScore(p.primary),
    secondary: clampScore(p.secondary),
    cp: clampScore(p.cp),
    deck: p.deck === 'defender' ? 'defender' : 'attacker',
    hand: Array.isArray(p.hand) ? p.hand : []
  };
}

function loadBattleState() {
  try {
    const saved = JSON.parse(localStorage.getItem(BATTLE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      // Migrate the old single-player flat shape ({primary, secondary, cp,
      // deck, hand, turn:'you'|'opp'}) into the new per-player array.
      let players;
      if (Array.isArray(saved.players)) {
        players = [sanitizePlayer(saved.players[0]), sanitizePlayer(saved.players[1])];
      } else {
        players = [sanitizePlayer(saved), defaultPlayer()];
      }
      let turn = saved.turn === 'opp' ? 'p2' : (saved.turn === 'you' ? 'p1' : saved.turn);
      if (turn !== 'p1' && turn !== 'p2') turn = 'p1';
      const round = Math.max(1, Math.min(BB_ROUNDS, parseInt(saved.round, 10) || 1));
      return { round: round, turn: turn, twoPlayer: !!saved.twoPlayer, players: players };
    }
  } catch (e) { /* corrupt entry — fall back to defaults */ }
  return defaultBattleState();
}

function saveBattleState() {
  localStorage.setItem(BATTLE_KEY, JSON.stringify(battleState));
}

function activePlayerCount() { return battleState.twoPlayer ? 2 : 1; }

function deckCards(deckKey) {
  const decks = window.SECONDARY_DECKS || {};
  return decks[deckKey] || [];
}

function initBattleBoard() {
  battleState = loadBattleState();
  const tp = document.getElementById('bbTwoPlayer');
  if (tp) {
    tp.checked = !!battleState.twoPlayer;
    const pill = tp.closest('.toggle-pill');
    if (pill) pill.dataset.checked = String(!!battleState.twoPlayer);
  }
  renderBattleBoard();
}

function syncBattleRadio(name, value) {
  const radio = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
  if (radio) radio.checked = true;
}

function setTwoPlayer(on) {
  battleState.twoPlayer = !!on;
  saveBattleState();
  renderBoards();
  renderRoundTurn();
}

function bbAdjust(p, field, delta) {
  const player = battleState.players[p];
  if (!player || !(field in player)) return;
  player[field] = clampScore((player[field] || 0) + delta);
  saveBattleState();
  renderCounters(p);
}

function setBattleDeck(p, deck) {
  const player = battleState.players[p];
  if (!player) return;
  player.deck = deck === 'defender' ? 'defender' : 'attacker';
  saveBattleState();
}

function setBattleTurn(turn) {
  if (turn !== 'p1' && turn !== 'p2') return;
  battleState.turn = turn;
  saveBattleState();
}

function bbAdjustRound(delta) {
  battleState.round = Math.max(1, Math.min(BB_ROUNDS, (battleState.round || 1) + delta));
  saveBattleState();
  renderRoundTurn();
}

// Draw N distinct random cards from a deck (Fisher–Yates pick). Each drawn
// card is stamped with its source deck so its accent stays correct.
function drawFromDeck(deckKey, n, excludeIds) {
  excludeIds = excludeIds || [];
  const pool = deckCards(deckKey).filter(c => excludeIds.indexOf(c.id) === -1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  return pool.slice(0, n).map(c => Object.assign({}, c, { deck: deckKey }));
}

function drawSecondaries(p) {
  const player = battleState.players[p];
  if (!player) return;
  if (!deckCards(player.deck).length) { toast('Deck is empty', 'error'); return; }
  player.hand = drawFromDeck(player.deck, BB_HAND_SIZE);
  saveBattleState();
  renderHand(p);
}

function bbDiscard(p, slot) {
  const player = battleState.players[p];
  if (!player) return;
  const exclude = player.hand.map(c => c.id);
  const replacement = drawFromDeck(player.deck, 1, exclude)[0];
  if (!replacement) { toast('No fresh cards left in deck', 'error'); return; }
  player.hand[slot] = replacement;
  saveBattleState();
  renderHand(p);
}

function resetBattleBoard() {
  if (!confirm('Reset the Battle Board? This clears scores, CP, round, and drawn cards for both players.')) return;
  const keepTwoPlayer = battleState.twoPlayer;
  battleState = defaultBattleState();
  battleState.twoPlayer = keepTwoPlayer;
  saveBattleState();
  renderBattleBoard();
  toast('Battle Board reset');
}

function renderBattleBoard() {
  renderBoards();
  renderRoundTurn();
}

function renderRoundTurn() {
  const el = document.getElementById('bbRoundVal');
  if (el) el.textContent = String(battleState.round || 1);
  syncBattleRadio('bbTurn', battleState.turn);
}

function playerLabel(p) { return 'Player ' + (p + 1); }

// Build the board markup for the active player count. Counter/hand values
// are then patched in by id (no full re-render on every +/- tap → e-ink
// friendly). Called only when the panel set changes (toggle, reset, init).
function renderBoards() {
  const wrap = document.getElementById('bbBoards');
  if (!wrap) return;
  const count = activePlayerCount();
  wrap.className = 'bb-boards' + (count === 2 ? ' two' : '');
  let html = '';
  for (let p = 0; p < count; p++) html += boardHtml(p);
  wrap.innerHTML = html;
  for (let p = 0; p < count; p++) {
    syncBattleRadio('bbDeck' + p, battleState.players[p].deck);
    renderCounters(p);
    renderHand(p);
  }
}

function boardHtml(p) {
  return ''
    + '<div class="bb-board" data-player="' + p + '">'
    +   (battleState.twoPlayer ? '<div class="bb-board-head">' + playerLabel(p) + '</div>' : '')
    +   '<div class="bb-total"><span class="bb-total-label">Total VP</span>'
    +     '<span class="bb-total-value" id="bbTotalVal' + p + '">0</span></div>'
    +   '<div class="bb-counters">'
    +     counterHtml(p, 'primary', 'Primary VP', 'amber')
    +     counterHtml(p, 'secondary', 'Secondary VP', 'violet')
    +     counterHtml(p, 'cp', 'Command Points', 'emerald')
    +   '</div>'
    +   '<div class="bb-deck">'
    +     '<label class="field-label">Secondary Deck</label>'
    +     '<div class="keypad bb-deck-select" id="bbDeckSelect' + p + '">'
    +       '<input type="radio" id="bbDeck' + p + '_attacker" name="bbDeck' + p + '" value="attacker" onchange="setBattleDeck(' + p + ',&#39;attacker&#39;)"><label for="bbDeck' + p + '_attacker">Attacker</label>'
    +       '<input type="radio" id="bbDeck' + p + '_defender" name="bbDeck' + p + '" value="defender" onchange="setBattleDeck(' + p + ',&#39;defender&#39;)"><label for="bbDeck' + p + '_defender">Defender</label>'
    +     '</div>'
    +     '<button type="button" class="action-btn primary" onclick="drawSecondaries(' + p + ')">Draw 2 Secondaries</button>'
    +     '<div id="bbHand' + p + '" class="bb-hand"></div>'
    +   '</div>'
    + '</div>';
}

function counterHtml(p, field, label, tone) {
  const idCap = field.charAt(0).toUpperCase() + field.slice(1);
  return ''
    + '<div class="bb-counter" data-tone="' + tone + '">'
    +   '<div class="bb-counter-label">' + label + '</div>'
    +   '<div class="bb-counter-stepper">'
    +     '<button type="button" class="bb-step" onclick="bbAdjust(' + p + ',&#39;' + field + '&#39;,-1)" aria-label="' + label + ' down">−</button>'
    +     '<span class="bb-counter-value" id="bb' + idCap + 'Val' + p + '">0</span>'
    +     '<button type="button" class="bb-step" onclick="bbAdjust(' + p + ',&#39;' + field + '&#39;,1)" aria-label="' + label + ' up">+</button>'
    +   '</div>'
    + '</div>';
}

function renderCounters(p) {
  const player = battleState.players[p];
  if (!player) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
  set('bbPrimaryVal' + p, player.primary);
  set('bbSecondaryVal' + p, player.secondary);
  set('bbCpVal' + p, player.cp);
  set('bbTotalVal' + p, player.primary + player.secondary);
}

function renderHand(p) {
  const player = battleState.players[p];
  const wrap = document.getElementById('bbHand' + p);
  if (!wrap || !player) return;
  if (!player.hand.length) {
    wrap.innerHTML = '<div class="empty-state">No cards drawn — pick a deck and tap "Draw 2 Secondaries".</div>';
    return;
  }
  wrap.innerHTML = player.hand.map((card, i) =>
    '<div class="bb-card" data-deck="' + (card.deck === 'defender' ? 'defender' : 'attacker') + '">'
    + '<div class="bb-card-head"><span class="bb-card-name">' + escapeHtml(card.name) + '</span>'
    + '<span class="bb-card-vp">' + escapeHtml(card.vp || '') + '</span></div>'
    + '<p class="bb-card-text">' + escapeHtml(card.text || '') + '</p>'
    + '<button type="button" class="bb-card-discard" onclick="bbDiscard(' + p + ',' + i + ')">↻ Discard &amp; draw new</button>'
    + '</div>'
  ).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('change', onPillChange);

  // Soft click sound on any selection action. Capture phase keeps the tone
  // tightly coupled to the press, before the handler runs.
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('button');
    if (btn) playClick();
  }, true);

  // Same sound when a radio/checkbox toggles or a dropdown selection lands.
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('input[type="radio"], input[type="checkbox"], select')) {
      playClick();
    }
  });

  populateTargetDropdown();
  updateRosterDropdown();
  updateTargetUi();
  addWeaponCard();   // start with one weapon
  renderQuickRoll();
  initBattleBoard();
});
