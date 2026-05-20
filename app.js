'use strict';

/* ===================================================================
 *  D6 Pipeline — attack resolver + quick dice roller
 *  Single-file vanilla JS. State lives in the DOM and localStorage.
 * =================================================================== */

// ───────────────────────────────────────────────────────────────────
//  Constants
// ───────────────────────────────────────────────────────────────────

const TARGET_PROFILES = {
  intercessor: { name: 'Space Marine Intercessor', t: 4,  sv: 3, inv: 0, w: 2,  isSingleModel: false, halfSize: 5,  fullSize: 10 },
  ork_boy:     { name: 'Ork Boy',                  t: 5,  sv: 6, inv: 0, w: 1,  isSingleModel: false, halfSize: 10, fullSize: 20 },
  terminator:  { name: 'Space Marine Terminator',  t: 5,  sv: 2, inv: 4, w: 3,  isSingleModel: false, halfSize: 5,  fullSize: 10 },
  gaunt:       { name: 'Tyranid Gaunt',            t: 3,  sv: 5, inv: 0, w: 1,  isSingleModel: false, halfSize: 10, fullSize: 20 },
  custodian:   { name: 'Custodian Guard',          t: 6,  sv: 2, inv: 4, w: 3,  isSingleModel: false, halfSize: 4,  fullSize: 5 },
  necron_warrior: { name: 'Necron Warrior',        t: 4,  sv: 4, inv: 0, w: 1,  isSingleModel: false, halfSize: 10, fullSize: 20 },
  land_raider: { name: 'Land Raider',              t: 12, sv: 2, inv: 0, w: 16, isSingleModel: true,  halfSize: 1,  fullSize: 1 },
  knight:      { name: 'Imperial Knight',          t: 12, sv: 3, inv: 5, w: 22, isSingleModel: true,  halfSize: 1,  fullSize: 1 }
};

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
//  Dice expression parser
// ───────────────────────────────────────────────────────────────────

function rollD6() { return Math.floor(Math.random() * 6) + 1; }
function rollDN(n) { return Math.floor(Math.random() * n) + 1; }

function parseDice(expr) {
  if (typeof expr === 'number') return { count: 0, sides: 0, mod: expr };
  const s = String(expr ?? '').trim().toUpperCase().replace(/\s+/g, '');
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
    base = { ...p };
    const sizeMode = document.getElementById('unitSizeSelect').value;
    modelCount = p.isSingleModel ? 1 : (sizeMode === 'full' ? p.fullSize : p.halfSize);
  } else {
    base = null;
  }

  // Defensive modifiers (apply regardless of preset)
  const cover = document.getElementById('defCover')?.checked || false;
  const minusOneDamage = document.getElementById('defMinusDmg')?.checked || false;
  const halveDamage = document.getElementById('defHalveDmg')?.checked || false;
  const stealthHit = document.getElementById('defStealth')?.checked || false;
  const minusOneWound = document.getElementById('defMinusWound')?.checked || false;
  const fnp = parseInt(getCheckedKeypad('defFnp') || '0', 10);

  if (base) {
    return {
      hasTarget: true,
      target: { ...base, modelCount, cover, minusOneDamage, halveDamage, stealthHit, minusOneWound, fnp }
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

function buildDiceInput(cls, value, chips, label) {
  const safeId = `${cls}_${Math.random().toString(36).slice(2, 8)}`;
  return `
    <div class="dice-input" data-dice-input="${safeId}">
      <label class="field-label">${label}</label>
      <input type="text" class="dice-input-field ${cls}" value="${value}"
             oninput="onDiceInputChange(this)" autocomplete="off"
             inputmode="text" spellcheck="false">
      <div class="dice-input-chips">
        ${chips.map(c => `<button type="button" class="dice-chip" data-value="${c}" onclick="setDiceValue(this, '${c}')">${c}</button>`).join('')}
      </div>
      <div class="dice-meta" data-dice-meta>${describeDice(value)}</div>
    </div>
  `;
}

function describeDice(expr) {
  if (!isValidDiceExpr(expr)) return 'Invalid — try 6, D6, 2D6, D6+1';
  const avg = avgDiceExpr(expr);
  const p = parseDice(expr);
  if (p.count === 0) return `fixed ${p.mod}`;
  return `avg ${formatAvg(avg)} (random)`;
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
  if (meta) meta.textContent = describeDice(input.value);
  // Active chip highlight
  wrap.querySelectorAll('.dice-chip').forEach(c => {
    c.dataset.active = String(c.dataset.value.toUpperCase() === String(input.value).trim().toUpperCase());
  });
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
  const s = {
    name: `Weapon ${id}`,
    attacks: '4',
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
    ignoresCover: false,
    ...migrateLegacyWeapon(state)
  };

  const html = `
    <div class="weapon-card" id="weaponCard_${id}" data-weapon-id="${id}">
      <div class="weapon-header">
        <input type="text" class="weapon-name-input w-name" value="${escapeHtml(s.name)}">
        <button class="weapon-action-btn clone" title="Duplicate weapon" onclick="cloneWeapon(${id})">⎘</button>
        <button class="weapon-action-btn" title="Remove weapon" onclick="this.closest('.weapon-card').remove()">×</button>
      </div>

      <div class="grid-2">
        <div>${buildDiceInput('w-attacks', s.attacks, ATTACK_CHIPS, 'Attacks')}</div>
        <div>${buildDiceInput('w-damage', s.damage, DAMAGE_CHIPS, 'Damage')}</div>
      </div>

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

  // Roll attacks (variable dice)
  let attacks = rollDiceExpr(w.attacks);
  if (w.blast && hasTarget && target.modelCount) {
    attacks += Math.floor(target.modelCount / 5);
  }
  if (attacks <= 0) return null;

  // Roll damage characteristic for this volley
  let baseDamage = rollDiceExpr(w.damage);
  if (w.melta > 0 && w.inMeltaRange) baseDamage += w.melta;

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
      damageBundles.push({ damage: baseDamage, mortal: false });
    } else {
      const r = rollD6();
      if (r < saveTarget) {
        result.failedSaves++;
        damageBundles.push({ damage: baseDamage, mortal: false });
      }
    }
  }
  for (let i = 0; i < devastatingWounds; i++) {
    damageBundles.push({ damage: baseDamage, mortal: true });
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
//  Pipeline runner (single-run or multi-iteration)
// ───────────────────────────────────────────────────────────────────

function executePipeline(rounds = 1, iterations = 1) {
  const cards = document.querySelectorAll('.weapon-card');
  if (!cards.length) return toast('Add at least one weapon first', 'warn');

  // Validate all dice expressions
  for (const c of cards) {
    if (!isValidDiceExpr(c.querySelector('.w-attacks').value) ||
        !isValidDiceExpr(c.querySelector('.w-damage').value)) {
      return toast('One or more weapons has an invalid dice expression', 'error');
    }
  }

  const weapons = [...cards].map(c => readWeaponState(c));
  const { hasTarget, target } = readTargetState();
  const isAggregate = iterations > 1;

  // Accumulators (over iterations)
  const aggregate = weapons.map(w => ({
    name: w.name, ap: w.ap, damage: w.damage,
    attacks: 0, hits: 0, lethal: 0, sustained: 0, critHits: 0,
    normalWounds: 0, devWounds: 0, savesAttempted: 0, failedSaves: 0,
    totalDamage: 0, modelsKilled: 0, roundsActive: 0
  }));

  let aggUnitWiped = 0;
  let aggSurvivingModels = 0;
  let aggSurvivingHp = 0;
  let aggRoundWipedIn = 0;

  const log = [];
  if (isAggregate) log.push(`=== Aggregate over ${iterations} runs ===`);

  for (let iter = 0; iter < iterations; iter++) {
    const modelState = {
      currentWounds: hasTarget ? target.w : 0,
      aliveCount: hasTarget ? target.modelCount : 0,
      unitWipedOut: false
    };
    let roundWipedIn = 0;

    if (iter === 0 && !isAggregate) log.push(`=== Engagement start (${rounds} round${rounds > 1 ? 's' : ''}) ===`);

    for (let r = 1; r <= rounds; r++) {
      if (modelState.unitWipedOut) break;
      if (iter === 0 && !isAggregate) log.push(`<span class="round">— Round ${r} —</span>`);

      weapons.forEach((w, idx) => {
        if (modelState.unitWipedOut) return;
        const result = resolveWeaponRound(w, { target, hasTarget, modelState }, iter === 0 && !isAggregate ? log : []);
        if (!result) return;
        const agg = aggregate[idx];
        agg.attacks += result.attacks;
        agg.hits += result.hits;
        agg.lethal += result.lethalAutoWounds;
        agg.sustained += result.sustainedBonusHits;
        agg.critHits += result.critHits;
        agg.normalWounds += result.normalWounds;
        agg.devWounds += result.devastatingWounds;
        agg.savesAttempted += result.savesAttempted;
        agg.failedSaves += result.failedSaves;
        agg.totalDamage += result.totalDamage;
        agg.modelsKilled += result.modelsKilled;
        agg.roundsActive += 1;
      });

      if (modelState.unitWipedOut) { roundWipedIn = r; break; }
    }

    if (modelState.unitWipedOut) {
      aggUnitWiped += 1;
      aggRoundWipedIn += roundWipedIn;
    } else {
      aggSurvivingModels += modelState.aliveCount;
      aggSurvivingHp += modelState.currentWounds;
    }
  }

  renderResults({
    aggregate, hasTarget, target, rounds, iterations,
    aggUnitWiped, aggSurvivingModels, aggSurvivingHp, aggRoundWipedIn,
    log
  });
}

// ───────────────────────────────────────────────────────────────────
//  Results rendering
// ───────────────────────────────────────────────────────────────────

function renderResults(ctx) {
  const { aggregate, hasTarget, target, rounds, iterations,
          aggUnitWiped, aggSurvivingModels, aggSurvivingHp, aggRoundWipedIn, log } = ctx;
  const isAggregate = iterations > 1;
  document.getElementById('resultsContainer').hidden = false;

  // ── Target status dashboard ──
  const dashboard = document.getElementById('targetStatusDashboard');
  dashboard.innerHTML = '';
  if (hasTarget) {
    if (isAggregate) {
      const wipeRate = (aggUnitWiped / iterations * 100).toFixed(1);
      const avgKillRound = aggUnitWiped > 0 ? (aggRoundWipedIn / aggUnitWiped).toFixed(1) : '—';
      const survivedIters = iterations - aggUnitWiped;
      const avgSurvivors = survivedIters > 0 ? (aggSurvivingModels / survivedIters).toFixed(1) : '—';
      dashboard.innerHTML = `
        <div class="target-status-card ${aggUnitWiped > iterations / 2 ? 'destroyed' : 'survived'}">
          <h3>${target.name}</h3>
          <p class="small">Wipe-out rate over ${iterations} sims: <strong>${wipeRate}%</strong></p>
          <p class="small">Avg wipe round: <strong>${avgKillRound}</strong> · Avg survivors when not wiped: <strong>${avgSurvivors}</strong></p>
        </div>`;
    } else {
      const wiped = aggUnitWiped > 0;
      const cardCls = wiped ? 'destroyed' : 'survived';
      const title = wiped ? 'Target Destroyed' : 'Target Survived';
      let body;
      if (rounds === 1) {
        body = wiped ? 'The single salvo completely wiped out the target unit.'
                     : `Surviving models: <strong>${aggSurvivingModels} / ${target.modelCount}</strong> (${aggSurvivingHp} HP on active model)`;
      } else {
        body = wiped ? `The entire unit was eliminated in <strong>Round ${aggRoundWipedIn}</strong>.`
                     : `Endured all ${rounds} rounds. Survivors: <strong>${aggSurvivingModels} / ${target.modelCount}</strong> (${aggSurvivingHp} HP on active model)`;
      }
      dashboard.innerHTML = `
        <div class="target-status-card ${cardCls}">
          <h3>${title}</h3>
          <p class="small">${body}</p>
        </div>`;
    }
  }

  // ── Per-weapon breakdown ──
  const blocks = document.getElementById('allocationBlocksContainer');
  blocks.innerHTML = '';

  let anyOutput = false;
  aggregate.forEach(a => {
    const totalWoundSuccesses = a.normalWounds + a.lethal + a.devWounds;
    if (totalWoundSuccesses === 0 && a.totalDamage === 0 && a.attacks === 0) return;
    anyOutput = true;

    const div = (numer, denom) => denom > 0 ? (numer / denom * 100).toFixed(1) + '%' : '—';
    const perRun = isAggregate ? `(avg ${(a.totalDamage / iterations).toFixed(1)}/run)` : '';

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
          <span>${a.totalDamage} ${perRun}</span>
        </div>
        <div class="alloc-row"><span>Models killed</span><strong>${a.modelsKilled}${isAggregate ? ` (avg ${(a.modelsKilled/iterations).toFixed(2)})` : ''}</strong></div>
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
    blocks.innerHTML = `<div class="empty-state">All weapons rolled out without producing any results.</div>`;
  }

  // ── Combat log ──
  const logEl = document.getElementById('combatLog');
  logEl.innerHTML = log.map(l => `<div>${l}</div>`).join('');

  // Scroll results into view on mobile
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

  tray.innerHTML = quickRollState.dice.map(d => {
    let cls = 'die';
    if (d === sides) cls += ' crit';
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
  if (t !== null) {
    summary.innerHTML = `<strong>${hits}</strong> hits · <span style="color:#fbbf24"><strong>${crits}</strong> crits</span> · <span style="color:#fb7185">${fails} fails</span> · ${quickRollState.dice.length} dice`;
  } else {
    summary.innerHTML = `<strong>Total:</strong> ${quickRollState.dice.reduce((s,n)=>s+n,0)} · <span style="color:#fbbf24"><strong>${crits}</strong> max-rolls</span>`;
  }
}

// ───────────────────────────────────────────────────────────────────
//  Init
// ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('change', onPillChange);
  updateRosterDropdown();
  updateTargetUi();
  addWeaponCard();   // start with one weapon
  renderQuickRoll();
});
