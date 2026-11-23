import A from 'https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js';
import {
  rigFov, cameraFov, mosaicPanels, mosaicExtent, asiairPlanText, panelName,
  sequenceSeconds, formatDuration, formatRa, formatDec, parseRa, parseDec,
  asiairToPa, paToAsiair, senderFile, orderPanels, PANEL_ORDERS, rigPlanUrl,
} from './mosaic.js';
import { LAYERS, skyLayers } from './layers.js';

// ---- cameras -------------------------------------------------------------
// Sensor sizes for common cameras. "Custom" leaves the fields as typed.
const CAMERAS = [
  { name: 'Custom', px: null },
  { name: 'ZWO ASI120MM / MC', px: 3.75, w: 1280, h: 960 },
  { name: 'ZWO ASI183MM / MC Pro', px: 2.4, w: 5496, h: 3672 },
  { name: 'ZWO ASI294MC Pro', px: 4.63, w: 4144, h: 2822 },
  { name: 'ZWO ASI533MM / MC Pro', px: 3.76, w: 3008, h: 3008 },
  { name: 'ZWO ASI585MC Pro', px: 2.9, w: 3840, h: 2160 },
  { name: 'ZWO ASI1600MM Pro', px: 3.8, w: 4656, h: 3520 },
  { name: 'ZWO ASI2400MC Pro', px: 5.94, w: 6072, h: 4042 },
  { name: 'ZWO ASI2600MM / MC (Pro, Duo, Air)', px: 3.76, w: 6248, h: 4176 },
  { name: 'ZWO ASI6200MM / MC Pro', px: 3.76, w: 9576, h: 6388 },
  { name: 'Canon EOS 60D', px: 4.3, w: 5184, h: 3456 },
];

const PALETTE = ['#ff5c5c', '#4fc3f7', '#ffd54f', '#81c784', '#ba68c8', '#ff8a65'];

// ---- state ---------------------------------------------------------------
const STORE_KEY = 'asiair-mosaic-planner.v1';
const uid = () => Math.random().toString(36).slice(2, 10);

function defaultState() {
  const rig = {
    id: uid(), name: 'Example rig', color: PALETTE[0],
    focalLength: 500, pixelSize: 3.76, sensorWidthPx: 6248, sensorHeightPx: 4176,
    fovWidth: null, fovHeight: null, angle: 0, controller: 'asiair',
  };
  return { version: 2, rigs: [rig], targets: [], selectedId: null, survey: 'P/DSS2/color' };
}

// The ASIAIR app recommends at least 15% overlap for imported mosaics.
const DEFAULT_OVERLAP = 0.15;
// Star Adventurer controller mosaics are shot with 20% overlap.
const SA_OVERLAP = 0.2;
// Star Adventurer controllers shoot a column at a time (DEC moves within a
// column), so their panels go column by column, back and forth.
const defaultOrder = (rig) => (isSa(rig) ? 'serpentine' : 'rows');
const SEQ_TYPES = ['Light', 'Dark', 'Flat', 'Bias'];
const newSeq = () => ({ type: 'Light', exp: 300, gain: '', repeat: 10, bin: 1 });

// What a rig's plans go to: the ASIAIR (by paste or the Plan Sender) or a
// Star Adventurer controller (sent over the network to its /plan address).
const CONTROLLERS = ['asiair', 'star-adventurer'];
const isSa = (rig) => rig?.controller === 'star-adventurer';

// Older saved plans lack newer fields.
function upgrade(s) {
  for (const r of s.rigs) {
    if (!Number.isFinite(r.angle)) r.angle = 0;
    if (!CONTROLLERS.includes(r.controller)) r.controller = 'asiair';
    if (typeof r.address !== 'string') r.address = '';
  }
  for (const t of s.targets) {
    if (!Array.isArray(t.seqs)) t.seqs = [newSeq()];
    if (!PANEL_ORDERS.includes(t.order)) t.order = 'rows';
    if (typeof t.useRigAngle !== 'boolean') t.useRigAngle = !t.pa;
    // Version 1 kept a target's own angle as a position angle; from version 2
    // every angle is stored the way the ASIAIR shows it.
    if ((s.version || 1) < 2 && !t.useRigAngle) t.pa = paToAsiair(t.pa || 0);
  }
  s.version = 2;
  return s;
}

// A target follows its rig's camera angle unless it has its own.
const rigAngle = (rig) => (rig && Number.isFinite(rig.angle) ? rig.angle : 0);
// Angles are kept and shown as the ASIAIR shows them; drawing needs the
// position angle.
const targetAngle = (t) => (t.useRigAngle ? rigAngle(rigById(t.rigId)) : t.pa);
const targetPa = (t) => asiairToPa(targetAngle(t));
const fmtAngle = (a) => `${Math.round(a * 10) / 10}°`;

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.rigs) && Array.isArray(s.targets)) return upgrade(s);
    }
  } catch { /* storage blocked or bad data: start fresh */ }
  return defaultState();
}

let state = loadState();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* fine: nothing kept */ }
}

const rigById = (id) => state.rigs.find((r) => r.id === id);
const selected = () => state.targets.find((t) => t.id === state.selectedId) || null;

// ---- dom helpers ---------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const k of kids) n.append(k);
  return n;
}
const fmtDeg = (d) => (d >= 1 ? `${d.toFixed(2)}°` : `${(d * 60).toFixed(1)}′`);

// ---- sky view ------------------------------------------------------------
let aladin = null;
let overlay = null;
let labels = null;
// The selected target sits at the centre of the view: dragging the sky moves
// it. Moves the page makes itself (going to a target) are ignored briefly.
let ignoreMovesUntil = 0;
let moveFrame = 0;
let saveTimer = 0;

// Known copies of each survey, most dependable first. The first copy that
// answers is used, so the view still works when one server is down. Only if
// none answers is the CDS registry asked for others.
const SURVEY_MIRRORS = {
  'P/DSS2/color': ['https://skies.esac.esa.int/DSSColor', 'https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color', 'https://alasky.cds.unistra.fr/DSS/DSSColor'],
  'P/DSS2/red': ['https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/red', 'https://alasky.cds.unistra.fr/DSS/DSS2Merged'],
  'CDS/P/PanSTARRS/DR1/color-z-zg-g': ['https://alasky.cds.unistra.fr/Pan-STARRS/DR1/color-z-zg-g'],
  'P/SDSS9/color': ['https://irsa.ipac.caltech.edu/data/hips/CDS/SDSS/DR9/color', 'https://alasky.cds.unistra.fr/SDSS/DR9/color'],
  'P/Mellinger/color': ['https://alasky.cds.unistra.fr/MellingerRGB'],
  'CDS/P/DESI-Legacy-Surveys/DR10/color': ['https://alasky.cds.unistra.fr/DESI-legacy-surveys/DR10/CDS_P_DESI-Legacy-Surveys_DR10_color'],
};

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
}

// All copies are asked at once, but the first one in list order that answers
// wins, without waiting for slower copies further down the list.
async function firstAnswering(urls) {
  const checks = urls.map((u) => withTimeout(fetch(`${u}/properties`).then((r) => r.ok), 5000).catch(() => false));
  for (let i = 0; i < urls.length; i++) if (await checks[i]) return urls[i];
  return null;
}

async function pickSurveyUrl(id) {
  const known = SURVEY_MIRRORS[id] ?? [];
  const url = await firstAnswering(known);
  if (url) return url;
  try {
    const cdsId = id.startsWith('CDS/') ? id : `CDS/${id}`;
    const r = await withTimeout(fetch(`https://alasky.cds.unistra.fr/MocServer/query?ID=${encodeURIComponent(cdsId)}&fmt=json&get=record`), 5000);
    const rec = (await r.json())[0] || {};
    const listed = Object.keys(rec).filter((k) => /^hips_service_url(_\d+)?$/.test(k)).sort().map((k) => rec[k]);
    return await firstAnswering(listed.filter((u) => !known.includes(u)));
  } catch {
    return null; // registry unreachable too
  }
}

let surveyRequest = 0;
async function showSurvey(id) {
  const box = $('#sky-error');
  const request = ++surveyRequest;
  const url = await pickSurveyUrl(id);
  if (request !== surveyRequest) return; // another survey was chosen meanwhile
  if (!url) {
    const name = $(`#survey option[value="${id}"]`)?.textContent || 'That survey';
    const onlyCds = (SURVEY_MIRRORS[id] ?? []).every((u) => u.includes('cds.unistra.fr'));
    box.hidden = false;
    box.textContent = onlyCds
      ? `${name} only comes from CDS in Strasbourg, which isn’t answering just now. DSS colour, DSS red and SDSS colour come from other servers.`
      : `${name} can’t be reached just now. Try DSS colour, which has several copies.`;
    return;
  }
  box.hidden = true;
  aladin?.setBaseImageLayer(A.imageHiPS(url, { name: id }));
}

async function initSky() {
  try {
    await A.init;
  } catch (e) {
    const box = $('#sky-error');
    box.hidden = false;
    box.textContent = `The sky view could not start (${e}). It needs WebGL 2 and an internet connection.`;
    return;
  }
  const t = selected();
  aladin = A.aladin('#aladin', {
    survey: 'https://skies.esac.esa.int/DSSColor', // replaced by showSurvey below
    fov: 4,
    target: t ? `${t.ra} ${t.dec}` : '10.6847 41.2690', // M31
    cooFrame: 'ICRS',
    showReticle: true,
    showCooGrid: false,
    showFullscreenControl: false,
    showLayersControl: false,
    showGotoControl: false,
    showShareControl: false,
    showProjectionControl: false,
    showFrame: true,
  });
  overlay = A.graphicOverlay({ lineWidth: 2 });
  aladin.addOverlay(overlay);
  labels = A.catalog({ name: 'Panes', sourceSize: 0, displayLabel: true, labelColumn: 'name', labelColor: '#ffffff', labelFont: '12px sans-serif' });
  aladin.addCatalog(labels);
  ignoreMovesUntil = Date.now() + 1500;
  aladin.on('positionChanged', (e) => {
    if (!e || !Number.isFinite(e.ra) || Date.now() < ignoreMovesUntil) return;
    viewMoved(e.ra, e.dec);
  });
  setupFastDrag($('#aladin'));
  if (t) frameTarget(t);
  // Shapes added while the view is still starting up get lost, so draw
  // again once it has had a moment, and after the survey is chosen.
  draw();
  setTimeout(draw, 400);
  showSurvey(state.survey).then(draw);
  showLayer = skyLayers(A, aladin);
  for (const l of LAYERS) if (state.layers?.[l.id]) applyLayer(l.id, true);
}

// The view's centre moved (by dragging): the selected target follows it.
function viewMoved(ra, dec) {
  const t = selected();
  if (!t || t.locked) return;
  t.ra = ((ra % 360) + 360) % 360;
  t.dec = dec;
  if (!moveFrame) {
    moveFrame = requestAnimationFrame(() => {
      moveFrame = 0;
      draw();
      renderEditor();
    });
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { save(); renderTargets(); }, 400);
}

// Aladin moves the sky exactly with the pointer, which feels slow for
// framing. Mouse drags are taken over here and move the sky DRAG_SPEEDS
// times as far. Touch (pinch and drag on a tablet) is left to Aladin.
const DRAG_SPEEDS = [1, 1.5, 2];
const dragSpeed = () => (DRAG_SPEEDS.includes(state.dragSpeed) ? state.dragSpeed : 1.5);
function setupFastDrag(box) {
  let last = null;
  box.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || dragSpeed() === 1 || !(e.target instanceof HTMLCanvasElement)) return;
    e.stopPropagation();
    e.preventDefault();
    last = { x: e.clientX, y: e.clientY };
    box.style.cursor = 'grabbing';
  }, true);
  window.addEventListener('mousemove', (e) => {
    if (!last || !aladin) return;
    e.stopPropagation();
    const k = dragSpeed();
    const dx = (e.clientX - last.x) * k;
    const dy = (e.clientY - last.y) * k;
    last = { x: e.clientX, y: e.clientY };
    const [w, h] = aladin.getSize();
    const c = aladin.pix2world(w / 2 - dx, h / 2 - dy);
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return;
    ignoreMovesUntil = Date.now() + 100;
    aladin.gotoRaDec(c[0], c[1]);
    viewMoved(c[0], c[1]);
  }, true);
  window.addEventListener('mouseup', (e) => {
    if (!last) return;
    e.stopPropagation();
    last = null;
    box.style.cursor = '';
  }, true);
}

function frameTarget(t) {
  if (!aladin) return;
  const rig = rigById(t.rigId);
  if (!rig) return;
  const ext = mosaicExtent({ cols: t.cols, rows: t.rows, overlap: t.overlap, fov: rigFov(rig) });
  ignoreMovesUntil = Date.now() + 600;
  aladin.gotoRaDec(t.ra, t.dec);
  aladin.setFoV(Math.min(180, Math.max(ext.width, ext.height) * 1.8));
}

// Put the view's centre on a target without changing the zoom.
function centreOn(t) {
  if (!aladin) return;
  ignoreMovesUntil = Date.now() + 600;
  aladin.gotoRaDec(t.ra, t.dec);
}

// Mosaics other than the selected one are drawn faintly, so the one being
// worked on stands out.
const OTHER_OPACITY = 0.35;

function draw() {
  if (!overlay) return;
  overlay.removeAll();
  labels.removeAll();
  const sel = selected();
  const panes = [];
  for (const t of state.targets) {
    const rig = rigById(t.rigId);
    if (!rig) continue;
    const isSel = sel && t.id === sel.id;
    const panels = mosaicPanels({ centre: t, pa: targetPa(t), cols: t.cols, rows: t.rows, overlap: t.overlap, fov: rigFov(rig) });
    for (const p of panels) {
      overlay.add(A.polygon(p.corners.map((c) => [...c]), { color: rig.color, lineWidth: isSel ? 2.5 : 1, opacity: isSel ? 1 : OTHER_OPACITY }));
      if (isSel && panels.length > 1) panes.push(A.source(p.ra, p.dec, { name: `${p.row}-${p.col}` }));
      if (isSel && p.index === 1) {
        // A short tick inside the top edge of pane 1 shows which way is "up" for the camera.
        const [tl, tr] = p.corners;
        const mid = [(tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2];
        overlay.add(A.polyline([[...mid], [p.ra + (mid[0] - p.ra) * 0.8, p.dec + (mid[1] - p.dec) * 0.8]], { color: rig.color, lineWidth: 3 }));
      }
    }
  }
  if (panes.length) labels.addSources(panes);
}

// ---- sky layers ----------------------------------------------------------
// Grid, constellations and Messier objects, switched on and off with the
// chips under the header. Which ones are on is kept with the rest.
let showLayer = null;
const LAYER_SHORT = { grid: 'Grid', lines: 'Lines', borders: 'Borders', names: 'Names', messier: 'Messier' };

function applyLayer(id, on) {
  if (!showLayer) return;
  const err = $('#layer-error');
  showLayer(id, on).then(() => { err.hidden = true; }).catch(() => {
    err.hidden = false;
    err.textContent = `Couldn’t load the ${LAYERS.find((l) => l.id === id).label.toLowerCase()} just now. Try again in a moment.`;
    state.layers[id] = false;
    save();
    renderLayerChips();
  });
}

function renderLayerChips() {
  const box = $('#layer-chips');
  box.replaceChildren(...LAYERS.map((l) => {
    const on = !!state.layers?.[l.id];
    return el('button', {
      type: 'button', class: `chip${on ? ' on' : ''}`, 'aria-pressed': String(on), title: l.label,
      onclick: () => {
        state.layers = { ...(state.layers || {}), [l.id]: !on };
        save();
        renderLayerChips();
        applyLayer(l.id, !on);
      },
    }, LAYER_SHORT[l.id]);
  }));
}

// ---- rigs ----------------------------------------------------------------
let editingRigId = null;

// The rig in use: the selected target's rig, or else the one picked last.
// New targets get it, and picking a rig in the list gives it to the
// selected target too.
const activeRig = () => rigById(selected()?.rigId) || rigById(state.lastRigId) || state.rigs[0] || null;

// Give a target another rig. Overlap and panel order follow the rig's usual
// ones, unless they were changed by hand.
function setTargetRig(t, rigId) {
  t.rigId = rigId;
  const sa = isSa(rigById(rigId));
  if (sa && t.overlap === DEFAULT_OVERLAP) t.overlap = SA_OVERLAP;
  if (!sa && t.overlap === SA_OVERLAP) t.overlap = DEFAULT_OVERLAP;
  if (sa && t.order === 'rows') t.order = 'serpentine';
  if (!sa && t.order === 'serpentine') t.order = 'rows';
}

function useRig(id) {
  state.lastRigId = id;
  const t = selected();
  if (t && t.rigId !== id) setTargetRig(t, id);
  changed();
}

const COG_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

function renderRigs() {
  const list = $('#rig-list');
  list.replaceChildren();
  if (!state.rigs.length) list.append(el('li', { class: 'empty' }, 'Add a rig to see its field of view.'));
  const active = activeRig();
  $('#rig-hint').hidden = state.rigs.length < 2;
  for (const r of state.rigs) {
    const f = rigFov(r);
    const inUse = r.id === active?.id;
    const cls = ['rig', inUse ? 'in-use' : '', r.id === editingRigId ? 'editing' : ''].join(' ').trim();
    const cog = el('button', {
      type: 'button', class: 'rig-settings', title: `${r.name} settings`, 'aria-label': `${r.name} settings`,
      onclick: (e) => { e.stopPropagation(); if (editingRigId === r.id) closeRigForm(); else openRigForm(r.id); renderRigs(); },
    });
    cog.innerHTML = COG_SVG;
    list.append(el('li', { class: cls, style: `--rig:${r.color}`, title: inUse ? `Planning with ${r.name}` : `Plan with ${r.name}`, 'aria-current': inUse ? 'true' : 'false', onclick: () => useRig(r.id) },
      el('span', { class: 'dot', style: `background:${r.color}` }),
      el('span', { class: 'name' }, r.name),
      el('span', { class: 'meta' }, `${fmtDeg(f.width)} × ${fmtDeg(f.height)} · ${fmtAngle(rigAngle(r))}`),
      cog));
  }
}

function rigFormValues(form) {
  const num = (n) => { const v = parseFloat(form.elements[n].value); return Number.isFinite(v) ? v : null; };
  return {
    name: form.elements.name.value.trim() || 'Rig',
    color: form.elements.color.value,
    focalLength: num('focalLength'), pixelSize: num('pixelSize'),
    sensorWidthPx: num('sensorWidthPx'), sensorHeightPx: num('sensorHeightPx'),
    fovWidth: num('fovWidth'), fovHeight: num('fovHeight'),
    angle: (((num('angle') ?? 0) % 360) + 360) % 360,
    controller: CONTROLLERS.includes(form.elements.controller.value) ? form.elements.controller.value : 'asiair',
    address: form.elements.address.value.trim(),
  };
}

function updateRigSummary() {
  const form = $('#rig-form');
  const v = rigFormValues(form);
  const out = $('#rig-fov-summary');
  if (!(v.focalLength && v.pixelSize && v.sensorWidthPx && v.sensorHeightPx)) { out.textContent = ''; return; }
  const c = cameraFov(v);
  const f = rigFov(v);
  out.textContent = `Field ${fmtDeg(f.width)} × ${fmtDeg(f.height)}${v.fovWidth > 0 && v.fovHeight > 0 ? ' (from plate solve)' : ''}, ${c.scale.toFixed(2)}″/px.`;
}

function openRigForm(id) {
  const form = $('#rig-form');
  const r = id ? rigById(id) : {
    name: `Rig ${state.rigs.length + 1}`, color: PALETTE[state.rigs.length % PALETTE.length],
    focalLength: 400, pixelSize: 3.76, sensorWidthPx: 6248, sensorHeightPx: 4176,
  };
  editingRigId = id || null;
  for (const k of ['name', 'color', 'focalLength', 'pixelSize', 'sensorWidthPx', 'sensorHeightPx', 'fovWidth', 'fovHeight', 'angle', 'address']) {
    form.elements[k].value = r[k] ?? '';
  }
  form.elements.controller.value = r.controller || 'asiair';
  showControllerFields();
  const preset = CAMERAS.findIndex((c) => c.px === r.pixelSize && c.w === r.sensorWidthPx && c.h === r.sensorHeightPx);
  form.elements.preset.value = String(Math.max(0, preset));
  $('#rig-delete').hidden = !id;
  form.classList.remove('hidden');
  updateRigSummary();
  renderRigs();
}

function showControllerFields() {
  const form = $('#rig-form');
  const sa = form.elements.controller.value === 'star-adventurer';
  form.querySelectorAll('.sa-only').forEach((n) => { n.hidden = !sa; });
}

function closeRigForm() {
  editingRigId = null;
  $('#rig-form').classList.add('hidden');
  renderRigs();
}

function setupRigForm() {
  const form = $('#rig-form');
  const sel = form.elements.preset;
  CAMERAS.forEach((c, i) => sel.append(el('option', { value: String(i) }, c.name)));
  sel.addEventListener('change', () => {
    const c = CAMERAS[+sel.value];
    if (c.px) {
      form.elements.pixelSize.value = c.px;
      form.elements.sensorWidthPx.value = c.w;
      form.elements.sensorHeightPx.value = c.h;
    }
    updateRigSummary();
  });
  form.addEventListener('input', updateRigSummary);
  form.elements.controller.addEventListener('change', showControllerFields);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = rigFormValues(form);
    if (editingRigId) Object.assign(rigById(editingRigId), v);
    else state.rigs.push({ id: uid(), ...v });
    // New targets go to the rig set up last, unless a target is selected.
    state.lastRigId = editingRigId || state.rigs[state.rigs.length - 1].id;
    closeRigForm();
    changed();
  });
  $('#add-rig').addEventListener('click', () => openRigForm(null));
  $('#rig-cancel').addEventListener('click', closeRigForm);
  $('#rig-delete').addEventListener('click', () => {
    const used = state.targets.filter((t) => t.rigId === editingRigId).length;
    const r = rigById(editingRigId);
    if (!confirm(used ? `Delete ${r.name}? Its ${used} target(s) will move to another rig, or be removed if there is none.` : `Delete ${r.name}?`)) return;
    state.rigs = state.rigs.filter((x) => x.id !== editingRigId);
    const fallback = state.rigs[0];
    state.targets = fallback ? state.targets.map((t) => (t.rigId === editingRigId ? { ...t, rigId: fallback.id } : t)) : [];
    closeRigForm();
    changed();
  });
}

// ---- targets -------------------------------------------------------------
// A name for a target started from the sky view: Field 1, Field 2…
function nextFieldName() {
  const used = new Set(state.targets.map((t) => t.name));
  let n = 1;
  while (used.has(`Field ${n}`)) n++;
  return `Field ${n}`;
}

// Start a target wherever the sky view is pointing. The zoom stays as it is,
// unless the view is so wide that the new frame would be hard to see.
function addTargetHere() {
  if (!aladin) return;
  const [ra, dec] = aladin.getRaDec();
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return;
  addTarget(nextFieldName(), ((ra % 360) + 360) % 360, dec, { keepZoom: true });
  const t = selected();
  const rig = t && rigById(t.rigId);
  if (!rig) return;
  const f = rigFov(rig);
  const [viewW] = aladin.getFov();
  if (viewW > 10 * Math.max(f.width, f.height)) frameTarget(t);
  // Ready to rename.
  const name = $('#target-form')?.elements.name;
  name?.focus();
  name?.select();
}

function addTarget(name, ra, dec, { keepZoom = false } = {}) {
  const rig = activeRig();
  if (!rig) { $('#search-status').textContent = 'Add a rig first.'; return; }
  // A new target copies the exposures of the one selected before, if any.
  const seqs = selected()?.seqs?.map((s) => ({ ...s })) ?? [newSeq()];
  const t = { id: uid(), name, rigId: rig.id, ra, dec, pa: rigAngle(rig), useRigAngle: true, cols: 1, rows: 1, overlap: isSa(rig) ? SA_OVERLAP : DEFAULT_OVERLAP, order: defaultOrder(rig), seqs };
  state.targets.push(t);
  state.selectedId = t.id;
  changed();
  if (keepZoom) centreOn(t);
  else frameTarget(t);
}

function renderTargets() {
  const list = $('#target-list');
  list.replaceChildren();
  if (!state.targets.length) list.append(el('li', { class: 'empty' }, 'No targets yet. Search for one above, or move around the sky and press Add new.'));
  $('#browse').hidden = !selected();
  for (const t of state.targets) {
    const rig = rigById(t.rigId);
    list.append(el('li', {
      class: t.id === state.selectedId ? 'selected' : '',
      onclick: () => { state.selectedId = t.id; changed(); frameTarget(t); },
    },
    el('span', { class: 'dot', style: `background:${rig?.color ?? '#888'}` }),
    el('span', { class: 'name' }, t.name),
    el('span', { class: 'meta' }, `${t.cols * t.rows > 1 ? `${t.cols}×${t.rows}` : 'single'} · ${formatDuration(sequenceSeconds(isSa(rig) ? firstLight(t.seqs) : t.seqs) * t.cols * t.rows)} · ${rig?.name ?? 'no rig'}`)));
  }
}

let editorFor = null; // id the editor's fields were last filled from

function renderEditor() {
  const t = selected();
  const box = $('#editor');
  box.hidden = !t;
  $('#send').hidden = !t;
  if (!t) return;
  const form = $('#target-form');
  const rigSel = form.elements.rigId;
  rigSel.replaceChildren(...state.rigs.map((r) => el('option', { value: r.id }, r.name)));
  // Don't overwrite the field the person is typing in.
  const active = document.activeElement;
  const set = (n, v) => { if (form.elements[n] !== active) form.elements[n].value = v; };
  if (editorFor !== t.id) form.reset();
  editorFor = t.id;
  set('name', t.name);
  set('rigId', t.rigId);
  set('ra', formatRa(t.ra));
  set('dec', formatDec(t.dec));
  const pa = targetAngle(t);
  set('pa', pa);
  set('paNum', Math.round(pa * 10) / 10);
  form.elements.useRigAngle.checked = t.useRigAngle;
  form.elements.locked.checked = !!t.locked;
  form.elements.pa.disabled = form.elements.paNum.disabled = t.useRigAngle;
  const ra0 = rigAngle(rigById(t.rigId));
  $('#rig-angle').textContent = `(${fmtAngle(ra0)})`;
  const note = $('#angle-note');
  const diff = Math.abs(((pa - ra0 + 540) % 360) - 180);
  note.hidden = t.useRigAngle || diff < 0.5;
  note.textContent = `Rotate the camera to ${fmtAngle(pa)} for this target (the rig is set to ${fmtAngle(ra0)}).`;
  set('cols', t.cols);
  set('rows', t.rows);
  set('overlapNum', Math.round(t.overlap * 100));
  set('order', t.order || 'rows');
  $('#order-row').hidden = t.cols * t.rows === 1;
  $('#editor-title').textContent = t.name;

  const rig = rigById(t.rigId);
  const fov = rigFov(rig);
  const ext = mosaicExtent({ cols: t.cols, rows: t.rows, overlap: t.overlap, fov });
  const n = t.cols * t.rows;
  $('#target-summary').textContent = n > 1
    ? `${n} panels of ${fmtDeg(fov.width)} × ${fmtDeg(fov.height)}, covering ${fmtDeg(ext.width)} × ${fmtDeg(ext.height)}.`
    : `One frame of ${fmtDeg(fov.width)} × ${fmtDeg(fov.height)}.`;

  $('#csv-text').value = textForTargets([t]);
  $('#copy-rig').textContent = `Copy all for ${rig.name}`;
  $('#send-rig').textContent = `Send file: all for ${rig.name}`;
  $('#sa-send-rig').textContent = `Send to rig: all for ${rig.name}`;
  $('#send-sa').hidden = !isSa(rig);
  $('#send-asiair').hidden = isSa(rig);
  const rows = $('#panel-rows');
  rows.replaceChildren();
  const ordered = orderPanels(mosaicPanels({ centre: t, pa: targetPa(t), cols: t.cols, rows: t.rows, overlap: t.overlap, fov }), t.order, targetPa(t));
  for (const [i, p] of ordered.entries()) {
    rows.append(el('tr', {}, el('td', {}, n > 1 ? `${i + 1}. ${panelName(t.name, p, n)}` : panelName(t.name, p, n)),
      el('td', {}, formatRa(p.ra)), el('td', {}, formatDec(p.dec)), el('td', {}, `${paToAsiair(p.pa).toFixed(1)}°`)));
  }
  renderSeqs(t);
}

// ---- exposure lines ------------------------------------------------------
function renderSeqs(t) {
  const list = $('#seq-list');
  // Leave the list alone while someone is typing in it.
  // Star Adventurer controllers set the camera's ISO themselves and don't
  // bin, so gain and binning are shown greyed out for them.
  const sa = isSa(rigById(t.rigId));
  const key = `${t.id}:${sa}`;
  if (list.contains(document.activeElement) && list.dataset.for === key) {
    updateSeqSummary(t);
    return;
  }
  list.dataset.for = key;
  list.replaceChildren();
  if (!t.seqs.length) list.append(el('p', { class: 'empty' }, 'No exposures yet.'));
  $('.seq-labels').hidden = !t.seqs.length;
  t.seqs.forEach((s, i) => {
    const typeSel = el('select', { 'data-i': i, 'data-k': 'type', 'aria-label': 'Frame type' },
      ...SEQ_TYPES.map((x) => el('option', { value: x }, x)));
    typeSel.value = s.type;
    const binSel = el('select', { 'data-i': i, 'data-k': 'bin', 'aria-label': 'Binning' },
      ...[1, 2, 3, 4].map((b) => el('option', { value: String(b) }, String(b))));
    binSel.value = String(s.bin);
    if (sa) {
      binSel.disabled = true;
      binSel.title = 'The Star Adventurer controller doesn’t bin';
    }
    const num = (k, label, attrs = {}) => {
      const inp = el('input', { type: 'number', 'data-i': i, 'data-k': k, min: '0', 'aria-label': label, ...attrs });
      inp.value = s[k] ?? '';
      return inp;
    };
    list.append(el('div', { class: 'seq' },
      typeSel,
      num('exp', 'Exposure in seconds', { step: 'any' }),
      sa
        ? el('input', { type: 'text', disabled: '', 'aria-label': 'Gain (set by the controller)', placeholder: 'ISO', title: 'The Star Adventurer controller sets the camera’s ISO itself' })
        : num('gain', 'Gain (blank for default)', { step: '1', placeholder: 'auto' }),
      num('repeat', 'Frame count', { step: '1' }),
      binSel,
      el('button', { class: 'small ghost danger remove', type: 'button', 'data-remove': i, 'aria-label': 'Remove line', title: 'Remove line' }, '×')));
  });
  updateSeqSummary(t);
}

// A Star Adventurer controller shoots only the first Light line.
const firstLight = (seqs) => seqs.filter((s) => s.type === 'Light' && Number(s.exp) > 0 && Number(s.repeat) > 0).slice(0, 1);

function updateSeqSummary(t) {
  const n = t.cols * t.rows;
  const sa = isSa(rigById(t.rigId));
  const used = sa ? firstLight(t.seqs) : t.seqs;
  const per = sequenceSeconds(used);
  const frames = used.reduce((a, s) => a + (Number(s.repeat) || 0), 0);
  const note = $('#seq-note');
  note.hidden = !sa;
  if (sa) {
    const extra = t.seqs.length - used.length;
    note.classList.toggle('warn', extra > 0 || !used.length);
    note.textContent = !used.length
      ? 'The Star Adventurer controller needs a Light line: it shoots only the first one.'
      : extra > 0
        ? `The Star Adventurer controller shoots only the first Light line; the other ${extra === 1 ? 'line is' : `${extra} lines are`} ignored. The controller sets the ISO itself; gain and binning don’t apply.`
        : 'The Star Adventurer controller shoots this Light line on every panel and sets the ISO itself, so gain and binning don’t apply.';
  }
  $('#seq-summary').textContent = per
    ? (n > 1
      ? `${formatDuration(per)} per panel, ${formatDuration(per * n)} for all ${n} panels (${frames * n} frames).`
      : `${formatDuration(per)} in all (${frames} frames).`)
    : '';
}

function setupSeqs() {
  const list = $('#seq-list');
  list.addEventListener('input', (e) => {
    const t = selected();
    const { i, k } = e.target.dataset;
    if (!t || i === undefined) return;
    const s = t.seqs[+i];
    if (k === 'type') s.type = e.target.value;
    else if (k === 'bin') s.bin = +e.target.value;
    else if (k === 'gain') s.gain = e.target.value === '' ? '' : Math.max(0, Math.round(+e.target.value));
    else {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v) && v >= 0) s[k] = k === 'repeat' ? Math.round(v) : v;
    }
    changed();
  });
  list.addEventListener('click', (e) => {
    const i = e.target.dataset?.remove;
    const t = selected();
    if (i === undefined || !t) return;
    t.seqs.splice(+i, 1);
    list.dataset.for = '';
    changed();
  });
  $('#add-seq').addEventListener('click', () => {
    const t = selected();
    if (!t) return;
    const last = t.seqs[t.seqs.length - 1];
    t.seqs.push(last ? { ...last } : newSeq());
    list.dataset.for = '';
    changed();
  });
}

function setupTargetForm() {
  const form = $('#target-form');
  const clamp = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
  form.addEventListener('input', (e) => {
    const t = selected();
    if (!t) return;
    const f = form.elements;
    switch (e.target.name) {
      case 'name': t.name = f.name.value.trim() || 'Target'; break;
      case 'rigId': setTargetRig(t, f.rigId.value); break;
      case 'ra': { const v = parseRa(f.ra.value); if (Number.isFinite(v) && v >= 0 && v < 360) { t.ra = v; centreOn(t); } break; }
      case 'dec': { const v = parseDec(f.dec.value); if (Number.isFinite(v) && Math.abs(v) <= 90) { t.dec = v; centreOn(t); } break; }
      case 'locked': t.locked = f.locked.checked; if (!t.locked) centreOn(t); break;
      case 'useRigAngle': t.useRigAngle = f.useRigAngle.checked; if (!t.useRigAngle) t.pa = rigAngle(rigById(t.rigId)); break;
      case 'pa': t.pa = clamp(parseFloat(f.pa.value), 0, 360, 0); f.paNum.value = t.pa; break;
      case 'paNum': t.pa = clamp(parseFloat(f.paNum.value), 0, 360, t.pa); f.pa.value = t.pa; break;
      case 'cols': t.cols = Math.round(clamp(parseFloat(f.cols.value), 1, 12, t.cols)); break;
      case 'rows': t.rows = Math.round(clamp(parseFloat(f.rows.value), 1, 12, t.rows)); break;
      case 'order': t.order = PANEL_ORDERS.includes(f.order.value) ? f.order.value : 'rows'; break;
      case 'overlapNum': t.overlap = clamp(parseFloat(f.overlapNum.value), 0, 50, t.overlap * 100) / 100; break;
      default: return;
    }
    changed();
  });
  // Tidy the coordinate text once the person leaves the field.
  form.addEventListener('focusout', () => setTimeout(renderEditor));

  $('#target-delete').addEventListener('click', () => {
    const t = selected();
    if (!t || !confirm(`Remove ${t.name}?`)) return;
    state.targets = state.targets.filter((x) => x.id !== t.id);
    state.selectedId = state.targets[0]?.id ?? null;
    changed();
  });

  $('#add-here').addEventListener('click', addTargetHere);
  $('#browse').addEventListener('click', () => {
    state.selectedId = null;
    changed();
  });

  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#search').value.trim();
    const status = $('#search-status');
    if (!q) return;
    // Coordinates typed straight in: "RA, Dec".
    const m = q.match(/^(.+?)[,;]\s*(.+)$/);
    if (m && Number.isFinite(parseRa(m[1])) && Number.isFinite(parseDec(m[2]))) {
      addTarget('Custom target', parseRa(m[1]), parseDec(m[2]));
      status.textContent = '';
      $('#search').value = '';
      return;
    }
    status.textContent = `Looking up ${q}…`;
    resolveName(q).then((pos) => {
      if (!pos) {
        status.textContent = `Couldn't find “${q}”. Try a catalogue name (NGC 7000) or type “RA, Dec”.`;
        return;
      }
      status.textContent = '';
      $('#search').value = '';
      addTarget(q, pos.ra, pos.dec);
    });
  });
}

// Object names go to the Sesame name service (SIMBAD, NED, VizieR). It runs
// at CDS and at Harvard; both are asked and the first answer wins.
const SESAME = [
  'https://cds.unistra.fr/cgi-bin/nph-sesame/-oI/SNV?',
  'https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oI/SNV?',
];

async function resolveName(name) {
  const ask = async (base) => {
    const r = await withTimeout(fetch(base + encodeURIComponent(name)), 10000);
    const m = (await r.text()).match(/^%J\s+([\d.]+)\s+([+-][\d.]+)/m);
    if (!m) throw new Error('not found');
    return { ra: parseFloat(m[1]), dec: parseFloat(m[2]) };
  };
  try {
    return await Promise.any(SESAME.map(ask));
  } catch {
    return null;
  }
}

// ---- text for the ASIAIR app ---------------------------------------------
function textForTargets(targets) {
  return asiairPlanText(targets.filter((t) => rigById(t.rigId)).map((t) => ({
    name: t.name, centre: t, pa: targetPa(t), cols: t.cols, rows: t.rows, overlap: t.overlap, order: t.order, fov: rigFov(rigById(t.rigId)),
  })));
}

function setupCsv() {
  const status = $('#copy-status');
  const copy = async (targets) => {
    const text = textForTargets(targets);
    const box = $('#csv-text');
    box.value = text;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Older or locked-down browsers: copy from the text box instead.
      $('#csv-box').open = true;
      box.focus();
      box.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
    }
    const n = text.split('\n').length - 1;
    const what = targets.length > 1 ? ` from ${targets.length} targets` : '';
    status.textContent = ok
      ? `Copied ${n} target${n > 1 ? 's' : ''}${what}. Paste with Import in the ASIAIR app’s plan.`
      : 'The browser blocked copying. Select the text below and copy it, or use Download.';
  };
  $('#copy-target').addEventListener('click', () => {
    const t = selected();
    if (t) copy([t]);
  });
  $('#copy-rig').addEventListener('click', () => {
    const t = selected();
    if (t) copy(state.targets.filter((x) => x.rigId === t.rigId));
  });
  // Send files for the ASIAIR Plan Sender: one ASIAIR plan per target.
  const buildSendFile = (targets) => {
    const rig = rigById(targets[0].rigId);
    return senderFile(targets.filter((t) => rigById(t.rigId)).map((t) => ({
      name: t.name,
      target: { name: t.name, centre: t, pa: targetPa(t), cols: t.cols, rows: t.rows, overlap: t.overlap, order: t.order, fov: rigFov(rigById(t.rigId)) },
      exposures: t.seqs,
      angle: targetAngle(t),
    })), { rig: rig ? { name: rig.name, focalLength: rig.focalLength, fov: rigFov(rig), angle: rigAngle(rig) } : null });
  };
  const sendFile = (targets, out = status) => {
    const rig = rigById(targets[0].rigId);
    const file = buildSendFile(targets);
    const empty = file.plans.filter((p) => !p.exposures.length).map((p) => p.name);
    const base = targets.length > 1 ? `${safeName(rig?.name || 'rig')}_plans` : safeName(targets[0].name);
    download(`${base}.asiairplan`, JSON.stringify(file, null, 2), 'application/json');
    out.textContent = `Saved ${file.plans.length} plan${file.plans.length > 1 ? 's' : ''}`
      + (isSa(rig) ? '. Load it on the controller’s page.' : ' for the Plan Sender.')
      + (empty.length ? ` No exposures yet for: ${empty.join(', ')}.` : '');
  };
  // Straight to a Star Adventurer controller: POST the same send file to its /plan.
  const saStatus = $('#sa-status');
  const sendToRig = async (targets) => {
    const rig = rigById(targets[0].rigId);
    const url = rigPlanUrl(rig?.address);
    const file = buildSendFile(targets);
    saStatus.textContent = `Sending to ${url}…`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(file), signal: ctl.signal,
      });
      let reply = null;
      try { reply = await res.json(); } catch { /* not JSON */ }
      if (!res.ok || !reply || reply.ok === false) {
        saStatus.textContent = `The controller refused the plan: ${reply?.error || `HTTP ${res.status}`}.`;
        return;
      }
      const names = (reply.received || []).map((r) => (r.panels ? `${r.name} (${r.panels} panels)` : r.name || r)).join(', ') || `${file.plans.length} plan(s)`;
      const warn = (reply.warnings || []).length ? ` Notes: ${reply.warnings.join(' · ')}` : '';
      saStatus.textContent = `Sent: ${names}. Choose it on the controller’s page.${warn}`;
    } catch (e) {
      const https = location.protocol === 'https:' && url.startsWith('http:');
      saStatus.textContent = e.name === 'AbortError'
        ? `No answer from ${url} in 8 s. Is the controller on and on the same WiFi? Check the address in the rig’s settings, or use Save send file.`
        : https
          ? 'This browser won’t send from an https page to the controller (http). Open the planner from your computer (http://localhost), or use Save send file.'
          : `Couldn’t reach ${url}. Is the controller on and on the same WiFi? Check the address, or use Save send file.`;
    } finally {
      clearTimeout(timer);
    }
  };
  $('#sa-send-target').addEventListener('click', () => {
    const t = selected();
    if (t) sendToRig([t]);
  });
  $('#sa-send-rig').addEventListener('click', () => {
    const t = selected();
    if (t) sendToRig(state.targets.filter((x) => x.rigId === t.rigId));
  });
  $('#sa-file-target').addEventListener('click', () => {
    const t = selected();
    if (t) sendFile([t], saStatus);
  });
  $('#send-target').addEventListener('click', () => {
    const t = selected();
    if (t) sendFile([t]);
  });
  $('#send-rig').addEventListener('click', () => {
    const t = selected();
    if (t) sendFile(state.targets.filter((x) => x.rigId === t.rigId));
  });
  $('#download-text').addEventListener('click', () => {
    const t = selected();
    if (t) download(`${safeName(t.name)}.txt`, textForTargets([t]), 'text/plain');
  });
}

const safeName = (s) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'plan';
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- plan files ----------------------------------------------------------
function setupPlanFiles() {
  $('#export-plan').addEventListener('click', () => {
    download(`mosaic-plan-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ ...state, app: 'asiair-mosaic-planner' }, null, 2), 'application/json');
  });
  $('#import-plan').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const s = JSON.parse(await file.text());
      if (!Array.isArray(s.rigs) || !Array.isArray(s.targets)) throw new Error('not a plan file');
      if (!confirm(`Replace your ${state.targets.length} target(s) and ${state.rigs.length} rig(s) with the ${s.targets.length} target(s) and ${s.rigs.length} rig(s) in ${file.name}?`)) return;
      state = upgrade({ ...defaultState(), ...s });
      changed();
      const t = selected();
      if (t) frameTarget(t);
    } catch (err) {
      alert(`Couldn't open ${file.name}: ${err.message}`);
    }
  });
  renderLayerChips();
  const speed = $('#drag-speed');
  speed.value = String(dragSpeed());
  speed.addEventListener('change', () => {
    state.dragSpeed = Number(speed.value);
    save();
  });
  const survey = $('#survey');
  survey.value = state.survey;
  survey.addEventListener('change', () => {
    state.survey = survey.value;
    save();
    showSurvey(survey.value);
  });
}

// ---- wiring --------------------------------------------------------------
function changed() {
  save();
  renderRigs();
  renderTargets();
  renderEditor();
  draw();
}

setupRigForm();
setupTargetForm();
setupSeqs();
setupCsv();
setupPlanFiles();
changed();
initSky();
