// Extra things to show on the sky: a coordinate grid, constellation lines,
// borders and names, and Messier objects. The constellation and Messier data
// and NGC/IC data come from d3-celestial (BSD-3-Clause), loaded from jsDelivr the first time
// each one is switched on, so they don't depend on the CDS servers.

const DATA = 'https://cdn.jsdelivr.net/npm/d3-celestial@0.7.35/data/';

export const LAYERS = [
  { id: 'grid', label: 'Coordinate grid' },
  { id: 'lines', label: 'Constellation lines' },
  { id: 'borders', label: 'Constellation borders' },
  { id: 'names', label: 'Constellation names' },
  { id: 'messier', label: 'Messier objects' },
  { id: 'ngc', label: 'NGC and IC objects (zoom in to about 20° to see them)' },
  { id: 'nebulae', label: 'Bright nebulae: Sharpless (Sh2), LBN, Cederblad, RCW, van den Bergh, supernova remnants (zoom in to about 20°)' },
  { id: 'dark', label: 'Dark nebulae: LDN and Barnard (zoom in to about 20°)' },
];

// Deep-sky catalogues are too many to show over a wide view.
export const NGC_MAX_FOV = 20;
const ZOOMED = new Set(['ngc', 'nebulae', 'dark']);

// Which catalogue prefixes (as in "RCW 58") each deep-sky layer takes from
// d3-celestial's list.
const DSO_PREFIXES = {
  ngc: ['NGC', 'IC'],
  nebulae: ['Ced', 'RCW', 'VdB', 'SNR'],
  dark: [],
};
// The complete Sharpless, LBN, LDN and Barnard catalogues ship with the
// planner (data/nebulae.json, made by tools/build_catalogues.py from VizieR),
// because d3-celestial's list misses many of them.
const OWN = {
  nebulae: [['sh2', (n) => `Sh2-${n}`], ['lbn', (n) => `LBN ${n}`]],
  dark: [['ldn', (n) => `LDN ${n}`], ['b', (n) => `B ${n}`]],
};
let ownData = null;
function loadOwn() {
  ownData ??= fetch(new URL('../data/nebulae.json', import.meta.url)).then((r) => {
    if (!r.ok) throw new Error(`nebulae.json: ${r.status}`);
    return r.json();
  }).catch((e) => { ownData = null; throw e; });
  return ownData;
}
const DSO_NAMES = { ngc: 'NGC and IC', nebulae: 'Bright nebulae', dark: 'Dark nebulae' };

const COLOURS = {
  grid: '#8fb3ff',
  lines: '#7fc8ff',
  borders: '#d8a657',
  names: '#a9c7e8',
  messier: '#ff9f6b',
  ngc: '#c79bff',
  nebulae: '#ff7aa8',
  dark: '#b8c0cc',
};

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
    if (DSO_PREFIXES[id]) {
      // d3-celestial's deep-sky list down to magnitude 14, plus the planner's
      // own nebula catalogues; one layer per group.
      const [data, own] = await Promise.all([load('dsos.14.json'), OWN[id] ? loadOwn() : null]);
      const keep = new Set(DSO_PREFIXES[id]);
      const cat = A.catalog({ name: DSO_NAMES[id], shape: id === 'dark' ? 'square' : 'circle', sourceSize: 7, color: COLOURS[id], displayLabel: true, labelColumn: 'name', labelColor: COLOURS[id], labelFont: '11px sans-serif' });
      aladin.addCatalog(cat);
      cat.addSources(data.features
        .filter((f) => keep.has(String(f.properties.desig).split(' ')[0]))
        .map((f) => {
          const [ra, dec] = f.geometry.coordinates;
          const p = f.properties;
          return A.source(normRa(ra), dec, { name: p.desig, type: p.type || '', mag: p.mag || '' });
        }));
      for (const [key, label] of OWN[id] ?? []) {
        cat.addSources((own[key] ?? []).map(([n, ra, dec, size]) => A.source(ra, dec, { name: label(n), size: size ?? '' })));
      }
      return cat;
    }
    return null;
  }

  // Layers that should only show when zoomed in.
  const wanted = new Map();
  let fov = aladin.getFov()[0];
  const visible = (id) => wanted.get(id) && (!ZOOMED.has(id) || fov <= NGC_MAX_FOV);
  async function refresh(id) {
    if (!made.has(id)) return;
    const layer = await made.get(id).catch(() => null);
    if (layer) (visible(id) ? layer.show() : layer.hide());
  }
  aladin.on('zoomChanged', (f) => {
    fov = Array.isArray(f) ? f[0] : f;
    for (const id of ZOOMED) refresh(id);
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
