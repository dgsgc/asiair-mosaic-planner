// Extra things to show on the sky: a coordinate grid, constellation lines,
// borders and names, and one layer per object catalogue. Constellations,
// Messier, NGC, IC, Cederblad, RCW, van den Bergh and supernova remnant data
// come from d3-celestial (BSD-3-Clause) on jsDelivr. The complete Sharpless,
// LBN, LDN and Barnard catalogues ship with the planner (data/nebulae.json,
// made by tools/build_catalogues.py from VizieR), because d3-celestial's list
// misses many of them. Each is loaded the first time it's switched on, and
// none depends on the CDS servers.

const DATA = 'https://cdn.jsdelivr.net/npm/d3-celestial@0.7.35/data/';

// Deep-sky catalogues are too many to show over a wide view.
export const NGC_MAX_FOV = 20;

// group: 'sky' (drawn lines and names) or 'objects' (catalogues).
// d3: the catalogue prefix in d3-celestial's list ("RCW 58").
// own: the key in data/nebulae.json, with how to write its names.
export const LAYERS = [
  { id: 'grid', short: 'Grid', label: 'Coordinate grid', group: 'sky', colour: '#8fb3ff' },
  { id: 'lines', short: 'Lines', label: 'Constellation lines', group: 'sky', colour: '#7fc8ff' },
  { id: 'borders', short: 'Borders', label: 'Constellation borders', group: 'sky', colour: '#d8a657' },
  { id: 'names', short: 'Names', label: 'Constellation names', group: 'sky', colour: '#a9c7e8' },
  { id: 'messier', short: 'Messier', label: 'Messier objects (110)', group: 'objects', colour: '#ff9f6b' },
  { id: 'ngc', short: 'NGC', label: 'NGC objects to magnitude 14', group: 'objects', colour: '#c79bff', d3: 'NGC', zoomed: true },
  { id: 'ic', short: 'IC', label: 'IC objects to magnitude 14', group: 'objects', colour: '#a8b4ff', d3: 'IC', zoomed: true },
  { id: 'sh2', short: 'Sh2', label: 'Sharpless HII regions (313)', group: 'objects', colour: '#ff6b8a', own: 'sh2', name: (n) => `Sh2-${n}`, zoomed: true },
  { id: 'lbn', short: 'LBN', label: 'Lynds bright nebulae (1,125)', group: 'objects', colour: '#ff9ec0', own: 'lbn', name: (n) => `LBN ${n}`, zoomed: true },
  { id: 'ldn', short: 'LDN', label: 'Lynds dark nebulae (1,791)', group: 'objects', colour: '#b8c0cc', own: 'ldn', name: (n) => `LDN ${n}`, zoomed: true, shape: 'square' },
  { id: 'barnard', short: 'Barnard', label: 'Barnard dark nebulae (349)', group: 'objects', colour: '#d9dee6', own: 'b', name: (n) => `B ${n}`, zoomed: true, shape: 'square' },
  { id: 'ced', short: 'Ced', label: 'Cederblad bright nebulae', group: 'objects', colour: '#ffb27a', d3: 'Ced', zoomed: true },
  { id: 'rcw', short: 'RCW', label: 'RCW HII regions (southern sky)', group: 'objects', colour: '#ff8f6b', d3: 'RCW', zoomed: true },
  { id: 'vdb', short: 'vdB', label: 'van den Bergh reflection nebulae', group: 'objects', colour: '#7fb8ff', d3: 'VdB', zoomed: true },
  { id: 'snr', short: 'SNR', label: 'Supernova remnants', group: 'objects', colour: '#6fe0c8', d3: 'SNR', zoomed: true },
];
const byId = new Map(LAYERS.map((l) => [l.id, l]));
const COLOURS = Object.fromEntries(LAYERS.map((l) => [l.id, l.colour]));

/** Older saved choices had grouped layers; turn them into the catalogue ones. */
export function upgradeLayers(layers = {}) {
  const out = { ...layers };
  const groups = { ngc: ['ngc', 'ic'], nebulae: ['sh2', 'lbn', 'ced', 'rcw', 'vdb', 'snr'], dark: ['ldn', 'barnard'] };
  if (out.nebulae !== undefined || out.dark !== undefined || (out.ngc && out.ic === undefined)) {
    for (const [old, ids] of Object.entries(groups)) {
      if (out[old]) for (const id of ids) out[id] = true;
    }
    delete out.nebulae;
    delete out.dark;
  }
  return out;
}

let ownData = null;
function loadOwn() {
  ownData ??= fetch(new URL('../data/nebulae.json', import.meta.url)).then((r) => {
    if (!r.ok) throw new Error(`nebulae.json: ${r.status}`);
    return r.json();
  }).catch((e) => { ownData = null; throw e; });
  return ownData;
}

const rad = Math.PI / 180;
// d3-celestial gives RA from −180° to 180°.
const normRa = (ra) => ((ra % 360) + 360) % 360;

/** Points along the great circle from a to b, no more than `step` degrees apart. */
export function greatCircle(a, b, step = 1) {
  const v = ([ra, dec]) => [Math.cos(dec * rad) * Math.cos(ra * rad), Math.cos(dec * rad) * Math.sin(ra * rad), Math.sin(dec * rad)];
  const p = v(a);
  const q = v(b);
  const d = Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
  const n = Math.max(1, Math.ceil(d / rad / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const s = d < 1e-9 ? [1 - f, f] : [Math.sin((1 - f) * d) / Math.sin(d), Math.sin(f * d) / Math.sin(d)];
    const x = s[0] * p[0] + s[1] * q[0];
    const y = s[0] * p[1] + s[1] * q[1];
    const z = s[0] * p[2] + s[1] * q[2];
    out.push([normRa(Math.atan2(y, x) / rad), Math.asin(Math.max(-1, Math.min(1, z / Math.hypot(x, y, z)))) / rad]);
  }
  return out;
}

/**
 * Constellation borders run along lines of constant RA or Dec, so they are
 * filled in along RA and Dec (not great circles), the short way round in RA.
 */
export function alongRaDec(a, b, step = 1) {
  let dRa = b[0] - a[0];
  if (dRa > 180) dRa -= 360;
  if (dRa < -180) dRa += 360;
  const dDec = b[1] - a[1];
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dRa), Math.abs(dDec)) / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push([normRa(a[0] + (dRa * i) / n), a[1] + (dDec * i) / n]);
  return out;
}

function filled(line, fill) {
  const out = [];
  for (let i = 1; i < line.length; i++) {
    const seg = fill(line[i - 1], line[i]);
    out.push(...(i === 1 ? seg : seg.slice(1)));
  }
  return out;
}

const cache = new Map();
function load(file) {
  if (!cache.has(file)) {
    cache.set(file, fetch(DATA + file).then((r) => {
      if (!r.ok) throw new Error(`${file}: ${r.status}`);
      return r.json();
    }).catch((e) => { cache.delete(file); throw e; }));
  }
  return cache.get(file);
}

/**
 * Sets up the layers on an Aladin view. Returns show(id, on), which loads a
 * layer the first time it's needed.
 */
export function skyLayers(A, aladin) {
  const made = new Map();

  async function make(id) {
    if (id === 'lines' || id === 'borders') {
      const data = await load(id === 'lines' ? 'constellations.lines.json' : 'constellations.borders.json');
      const overlay = A.graphicOverlay({ color: COLOURS[id], lineWidth: id === 'lines' ? 1.2 : 1, opacity: id === 'lines' ? 0.55 : 0.5 });
      aladin.addOverlay(overlay);
      const fill = id === 'lines' ? greatCircle : alongRaDec;
      for (const f of data.features) {
        for (const line of f.geometry.coordinates) {
          const pts = filled(line.map(([ra, dec]) => [normRa(ra), dec]), fill);
          overlay.add(A.polyline(pts, { color: COLOURS[id] }));
        }
      }
      return overlay;
    }
    if (id === 'names') {
      const data = await load('constellations.json');
      const cat = A.catalog({ name: 'Constellations', sourceSize: 0, color: 'rgba(0,0,0,0)', displayLabel: true, labelColumn: 'name', labelColor: COLOURS.names, labelFont: '13px sans-serif' });
      aladin.addCatalog(cat);
      cat.addSources(data.features.map((f) => {
        const [ra, dec] = f.geometry.coordinates;
        return A.source(normRa(ra), dec, { name: f.properties.name });
      }));
      return cat;
    }
    if (id === 'messier') {
      const data = await load('messier.json');
      const cat = A.catalog({ name: 'Messier', shape: 'circle', sourceSize: 10, color: COLOURS.messier, displayLabel: true, labelColumn: 'name', labelColor: COLOURS.messier, labelFont: '12px sans-serif' });
      aladin.addCatalog(cat);
      cat.addSources(data.features.map((f) => {
        const [ra, dec] = f.geometry.coordinates;
        const p = f.properties;
        return A.source(normRa(ra), dec, { name: p.name, alt: p.alt || '', ngc: p.desig || '' });
      }));
      return cat;
    }
    const layer = byId.get(id);
    if (layer?.d3 || layer?.own) {
      const cat = A.catalog({ name: layer.label, shape: layer.shape || 'circle', sourceSize: 7, color: layer.colour, displayLabel: true, labelColumn: 'name', labelColor: layer.colour, labelFont: '11px sans-serif' });
      aladin.addCatalog(cat);
      if (layer.d3) {
        // d3-celestial's deep-sky list down to magnitude 14.
        const data = await load('dsos.14.json');
        cat.addSources(data.features
          .filter((f) => String(f.properties.desig).split(' ')[0] === layer.d3)
          .map((f) => {
            const [ra, dec] = f.geometry.coordinates;
            const p = f.properties;
            return A.source(normRa(ra), dec, { name: p.desig, type: p.type || '', mag: p.mag || '' });
          }));
      } else {
        const own = await loadOwn();
        cat.addSources((own[layer.own] ?? []).map(([n, ra, dec, size]) => A.source(ra, dec, { name: layer.name(n), size: size ?? '' })));
      }
      return cat;
    }
    return null;
  }

  // Layers that should only show when zoomed in.
  const wanted = new Map();
  let fov = aladin.getFov()[0];
  const visible = (id) => wanted.get(id) && (!byId.get(id)?.zoomed || fov <= NGC_MAX_FOV);
  async function refresh(id) {
    if (!made.has(id)) return;
    const layer = await made.get(id).catch(() => null);
    if (layer) (visible(id) ? layer.show() : layer.hide());
  }
  aladin.on('zoomChanged', (f) => {
    fov = Array.isArray(f) ? f[0] : f;
    for (const l of LAYERS) if (l.zoomed) refresh(l.id);
  });

  return async function show(id, on) {
    wanted.set(id, on);
    if (id === 'grid') {
      aladin.setCooGrid({ enabled: on, color: COLOURS.grid, opacity: 0.45, labelSize: 12 });
      return;
    }
    if (!made.has(id)) {
      if (!on) return;
      made.set(id, make(id));
    }
    let layer;
    try {
      layer = await made.get(id);
    } catch (e) {
      made.delete(id);
      throw e;
    }
    if (layer) (visible(id) ? layer.show() : layer.hide());
  };
}
