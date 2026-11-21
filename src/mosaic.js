// Mosaic geometry and CSV export. Pure functions, no browser APIs, so the
// same file runs in the page and under `node --test`.
//
// Conventions:
//   RA and Dec in degrees everywhere (RA 0..360).
//   Position angle (PA) in degrees, measured from north through east, the
//   way Telescopius reports it. PA 0 = the frame's top edge points north.
//   The sky view is drawn with north up and east to the left, so column 1
//   of a mosaic is its east-most column (as in Telescopius exports).

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function normRa(ra) {
  const r = ra % 360;
  return r < 0 ? r + 360 : r;
}

/** Field of view in degrees for a camera on a telescope. */
export function cameraFov({ focalLength, pixelSize, sensorWidthPx, sensorHeightPx, binning = 1 }) {
  // Field width from the sensor size: 2·atan(size / 2f). Binning doesn't change it.
  const wMm = (pixelSize / 1000) * sensorWidthPx;
  const hMm = (pixelSize / 1000) * sensorHeightPx;
  return {
    width: 2 * Math.atan(wMm / (2 * focalLength)) * R2D,
    height: 2 * Math.atan(hMm / (2 * focalLength)) * R2D,
    scale: (206.265 * pixelSize * binning) / focalLength, // arcsec per (binned) pixel
  };
}

/** Effective field of a rig: a measured override (from a plate solve) wins. */
export function rigFov(rig) {
  if (rig.fovWidth > 0 && rig.fovHeight > 0) {
    return { width: rig.fovWidth, height: rig.fovHeight };
  }
  return cameraFov(rig);
}

/**
 * Inverse gnomonic projection: a point on the tangent plane at (ra0, dec0)
 * back to the sky. xi points east, eta north; both in degrees (as tangents,
 * i.e. standard coordinates × 180/π).
 */
export function fromTangent(ra0, dec0, xi, eta) {
  const x = xi * D2R;
  const y = eta * D2R;
  const d0 = dec0 * D2R;
  const rho = Math.hypot(x, y);
  if (rho === 0) return { ra: normRa(ra0), dec: dec0 };
  const c = Math.atan(rho);
  const sinC = Math.sin(c);
  const cosC = Math.cos(c);
  const dec = Math.asin(cosC * Math.sin(d0) + (y * sinC * Math.cos(d0)) / rho);
  const ra = ra0 * D2R + Math.atan2(x * sinC, rho * Math.cos(d0) * cosC - y * Math.sin(d0) * sinC);
  return { ra: normRa(ra * R2D), dec: dec * R2D };
}

/** Forward gnomonic projection, the inverse of fromTangent. */
export function toTangent(ra0, dec0, ra, dec) {
  const d0 = dec0 * D2R;
  const d = dec * D2R;
  const da = (ra - ra0) * D2R;
  const cosC = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
  const xi = (Math.cos(d) * Math.sin(da)) / cosC;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / cosC;
  return { xi: xi * R2D, eta: eta * R2D };
}

/** Position angle (east of north) of point 2 as seen from point 1, degrees 0..360. */
export function bearing(ra1, dec1, ra2, dec2) {
  const d1 = dec1 * D2R;
  const d2 = dec2 * D2R;
  const da = (ra2 - ra1) * D2R;
  const y = Math.sin(da) * Math.cos(d2);
  const x = Math.cos(d1) * Math.sin(d2) - Math.sin(d1) * Math.cos(d2) * Math.cos(da);
  return normRa(Math.atan2(y, x) * R2D);
}

/** Angular separation in degrees. */
export function separation(ra1, dec1, ra2, dec2) {
  const d1 = dec1 * D2R;
  const d2 = dec2 * D2R;
  const da = (ra2 - ra1) * D2R;
  const a = Math.sin((d2 - d1) / 2) ** 2 + Math.cos(d1) * Math.cos(d2) * Math.sin(da / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) * R2D;
}

// A frame-local offset (u to the right on screen = west at PA 0, v up = north
// at PA 0) turned into tangent-plane xi (east) / eta (north) for a given PA.
function rotate(u, v, pa) {
  const t = pa * D2R;
  return {
    xi: -u * Math.cos(t) + v * Math.sin(t),
    eta: u * Math.sin(t) + v * Math.cos(t),
  };
}

/** The four corners of one frame (top-left, top-right, bottom-right, bottom-left). */
export function frameCorners(ra, dec, pa, width, height) {
  const hw = width / 2;
  const hh = height / 2;
  return [
    [-hw, hh],
    [hw, hh],
    [hw, -hh],
    [-hw, -hh],
  ].map(([u, v]) => {
    const { xi, eta } = rotate(u, v, pa);
    const p = fromTangent(ra, dec, xi, eta);
    return [p.ra, p.dec];
  });
}

/**
 * Work out the panels of a mosaic.
 *   centre: {ra, dec}  pa: degrees  cols, rows: counts  overlap: 0..0.9
 *   fov: {width, height} in degrees
 * Returns panels in Telescopius order (row 1 = top/north at PA 0, column 1 =
 * left/east), each with its own centre, local PA and corners.
 */
export function mosaicPanels({ centre, pa = 0, cols = 1, rows = 1, overlap = 0.1, fov }) {
  const stepU = fov.width * (1 - overlap);
  const stepV = fov.height * (1 - overlap);
  const panels = [];
  let n = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = (c - (cols - 1) / 2) * stepU;
      const v = ((rows - 1) / 2 - r) * stepV;
      const { xi, eta } = rotate(u, v, pa);
      const p = fromTangent(centre.ra, centre.dec, xi, eta);
      // The panel's own PA: the direction of the mosaic's "up" at this panel.
      // Away from the centre, meridians converge, so this differs a little
      // from the mosaic PA (Telescopius lists it per pane).
      const upTan = rotate(u, v + stepV * 0.01 + 1e-6, pa);
      const up = fromTangent(centre.ra, centre.dec, upTan.xi, upTan.eta);
      let localPa = bearing(p.ra, p.dec, up.ra, up.dec);
      panels.push({
        index: n++,
        row: r + 1,
        col: c + 1,
        ra: p.ra,
        dec: p.dec,
        pa: localPa,
        corners: frameCorners(p.ra, p.dec, localPa, fov.width, fov.height),
      });
    }
  }
  return panels;
}

/** Total sky area covered, for the summary line. */
export function mosaicExtent({ cols, rows, overlap, fov }) {
  return {
    width: fov.width * (cols - (cols - 1) * overlap),
    height: fov.height * (rows - (rows - 1) * overlap),
  };
}

// ---- formatting ----------------------------------------------------------

function sexagesimal(value, unitsPerWhole) {
  // Round to whole seconds first, then carry, so we never print 60".
  const total = Math.round(Math.abs(value) * unitsPerWhole * 3600);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const d = Math.floor(total / 3600);
  return { d, m, s };
}

const pad = (n) => String(n).padStart(2, '0');

/** RA as Telescopius writes it: 04hr 01' 17" */
export function formatRaTelescopius(ra) {
  let { d, m, s } = sexagesimal(normRa(ra), 1 / 15);
  if (d === 24) d = 0;
  return `${pad(d)}hr ${pad(m)}' ${pad(s)}"`;
}

/** Dec as Telescopius writes it: 36º 17' 44" (º is U+00BA, as in their export). */
export function formatDecTelescopius(dec) {
  const { d, m, s } = sexagesimal(dec, 1);
  const sign = dec < 0 && d + m + s > 0 ? '-' : '';
  return `${sign}${pad(d)}º ${pad(m)}' ${pad(s)}"`;
}

/** RA as 05h 35m 17.3s, for display. */
export function formatRa(ra) {
  const total = Math.round((normRa(ra) / 15) * 36000) % (24 * 36000);
  const ds = total % 600;
  const m = Math.floor(total / 600) % 60;
  const h = Math.floor(total / 36000);
  return `${pad(h)}h ${pad(m)}m ${(ds / 10).toFixed(1).padStart(4, '0')}s`;
}

/** Dec as +22° 00′ 52″, for display. */
export function formatDec(dec) {
  const { d, m, s } = sexagesimal(dec, 1);
  const sign = dec < 0 && d + m + s > 0 ? '−' : '+';
  return `${sign}${pad(d)}° ${pad(m)}′ ${pad(s)}″`;
}

/** Parse RA typed by a person: "5 35 17.3", "05h35m17s", "83.82" (degrees if it has a decimal and no separators > 24). */
export function parseRa(text) {
  const t = String(text).trim().toLowerCase();
  if (!t) return NaN;
  const parts = t.replace(/hr|[hms:'"°º]/g, ' ').split(/[\s,]+/).filter(Boolean).map(Number);
  if (parts.some(Number.isNaN)) return NaN;
  if (parts.length === 1) {
    const v = parts[0];
    // A bare number: hours if ≤ 24 and the text says "h", otherwise degrees.
    return /h/.test(t) ? v * 15 : v;
  }
  const [h, m = 0, s = 0] = parts;
  return (h + m / 60 + s / 3600) * 15;
}

/** Parse Dec: "+22 00 52", "-5°23'28\"", "-5.39". */
export function parseDec(text) {
  const t = String(text).trim();
  if (!t) return NaN;
  const neg = /^[-−]/.test(t);
  const parts = t.replace(/^[+\-−]/, '').replace(/[°º'′"″dms:]/g, ' ').split(/[\s,]+/).filter(Boolean).map(Number);
  if (parts.some(Number.isNaN) || parts.length === 0) return NaN;
  const [d, m = 0, s = 0] = parts;
  const v = d + m / 60 + s / 3600;
  return neg ? -v : v;
}

// ---- the ASIAIR's camera angle --------------------------------------------
// The ASIAIR (plate solve "angle", sky atlas "Rotation") measures the other
// way round from a position angle: PA of the frame's top = 180° − ASIAIR angle.
// Checked 18 Nov 2026 against the app's sky atlas (Rotation 148.8° drew a
// frame at PA 32°) and a 13 Nov plate solve (93° → image top at PA ≈ 83°).
// The formula is its own inverse.

/** ASIAIR angle → position angle (east of north) of the frame's top. */
export function asiairToPa(angle) {
  return (((180 - angle) % 360) + 360) % 360;
}

/** Position angle → the angle the ASIAIR shows. */
export const paToAsiair = asiairToPa;

// ---- the ASIAIR app's own plan text ----------------------------------------
// What the app's Share button writes and its Import accepts (checked with app
// 3.0.0, 18 Nov 2026):
//   Name,RA,DEC,Angle
//   Pane 1,21h 00m 33s,+44° 34′ 01″
// J2000. Dec needs °, ′ (U+2032) and ″ (U+2033): ASCII ' and " are rejected.
// The app leaves Angle empty; extra columns are accepted but ignored.

/** RA as the ASIAIR app writes it: 21h 00m 33s */
export function formatRaAsiair(ra) {
  let { d, m, s } = sexagesimal(normRa(ra), 1 / 15);
  if (d === 24) d = 0;
  return `${pad(d)}h ${pad(m)}m ${pad(s)}s`;
}

/** Dec as the ASIAIR app writes it: +44° 34′ 01″ */
export function formatDecAsiair(dec) {
  const { d, m, s } = sexagesimal(dec, 1);
  const sign = dec < 0 && d + m + s > 0 ? '-' : '+';
  return `${sign}${pad(d)}° ${pad(m)}′ ${pad(s)}″`;
}

/** A panel's target name, the way the ASIAIR app names its own mosaics: "NGC 7000_1-2". */
export function panelName(name, panel, count) {
  const clean = String(name).replace(/[,\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Target';
  return count > 1 ? `${clean}_${panel.row}-${panel.col}` : clean;
}

/**
 * Plan text for the ASIAIR app's Import: one line per panel of every target
 * given. Each target: {name, centre: {ra, dec}, pa, cols, rows, overlap, fov}.
 * No centre row (the app would make it a target of its own).
 */
/**
 * The order panels are shot in (names keep their row and column):
 *   'rows'       row by row, left to right (the default; Telescopius order)
 *   'serpentine' back and forth in DEC: panels are grouped along the grid
 *                direction closer to east–west, and within each group swept
 *                along the direction closer to north–south, reversing each
 *                group. Consecutive panels then differ in DEC, apart from one
 *                RA step per group (a Star Adventurer controller moves DEC
 *                itself). `pa` is the frame top's position angle: near 0°/180°
 *                that sweeps down the columns, near 90°/270° along the rows.
 */
export const PANEL_ORDERS = ['rows', 'serpentine'];

export function orderPanels(panels, order = 'rows', pa = 0) {
  if (order !== 'serpentine') return panels;
  // The grid's columns run along the frame's "up", which points to `pa`.
  const t = (pa * Math.PI) / 180;
  const columnsAreNorthSouth = Math.abs(Math.cos(t)) >= Math.abs(Math.sin(t));
  const group = columnsAreNorthSouth ? 'col' : 'row';
  const along = columnsAreNorthSouth ? 'row' : 'col';
  const n = Math.max(...panels.map((p) => p[group]));
  const out = [];
  for (let g = 1; g <= n; g++) {
    const line = panels.filter((p) => p[group] === g).sort((a, b) => a[along] - b[along]);
    out.push(...(g % 2 ? line : line.reverse()));
  }
  return out;
}

/** The panels of a target in its shooting order. */
export const targetPanels = (t) => orderPanels(mosaicPanels(t), t.order, t.pa || 0);

export function asiairPlanText(targets) {
  const lines = ['Name,RA,DEC,Angle'];
  for (const t of targets) {
    const panels = targetPanels(t);
    for (const p of panels) {
      lines.push(`${panelName(t.name, p, panels.length)},${formatRaAsiair(p.ra)},${formatDecAsiair(p.dec)},`);
    }
  }
  return lines.join('\n');
}

/**
 * A file for the ASIAIR Plan Sender helper: one ASIAIR plan per entry.
 * Each plan: {name, target: {name, centre, pa, cols, rows, overlap, fov}, exposures, angle?}.
 * `angle` (optional) is the camera angle as the ASIAIR shows it; it is written
 * to the plan as `angle` (added 19 Nov 2026; readers that don't know it ignore it).
 * The import text is included ready-made, so the helper needn't format it.
 */
export function senderFile(plans, { rig = null, created = new Date().toISOString() } = {}) {
  return {
    format: 'asiair-plan-sender',
    version: 1,
    created,
    rig,
    plans: plans.map(({ name, target, exposures, angle }) => {
      const panels = targetPanels(target);
      return {
        name: String(name).replace(/[\r\n]+/g, ' ').trim() || 'Plan',
        ...(Number.isFinite(angle) ? { angle: Math.round(angle * 10) / 10 } : {}),
        importText: asiairPlanText([target]),
        targets: panels.map((p) => ({ name: panelName(target.name, p, panels.length), ra: p.ra, dec: p.dec })),
        exposures: (exposures || [])
          .filter((s) => Number(s.exp) > 0 && Number(s.repeat) > 0)
          .map((s) => ({
            type: ['Light', 'Dark', 'Flat', 'Bias'].includes(s.type) ? s.type : 'Light',
            exposure: Number(s.exp),
            gain: s.gain === '' || s.gain === null || s.gain === undefined ? null : Math.round(Number(s.gain)),
            count: Math.round(Number(s.repeat)),
            bin: [1, 2, 3, 4].includes(Number(s.bin)) ? Number(s.bin) : 1,
          })),
      };
    }),
  };
}

/**
 * Where a Star Adventurer controller takes plans: its address plus /plan.
 * Accepts "rig.local", "http://rig.local", "http://192.168.1.50:8080/" and so on.
 * The controller receives the same send file as the ASIAIR Plan Sender, by HTTP POST.
 */
export function rigPlanUrl(address) {
  let a = String(address || '').trim();
  if (!a) a = 'rig.local';
  if (!/^https?:\/\//i.test(a)) a = `http://${a}`;
  a = a.replace(/\/+$/, '');
  if (!/\/plan$/.test(a)) a += '/plan';
  return a;
}

/** Total exposure time of a list of exposure lines, in seconds. */
export function sequenceSeconds(seqs = []) {
  return seqs.reduce((sum, s) => sum + (s.enabled === false ? 0 : (Number(s.exp) || 0) * (Number(s.repeat) || 0)), 0);
}

/** "3h 20m" style duration. */
export function formatDuration(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/**
 * The mosaic as a Telescopius-style CSV, which the ASIAIR app's Plan screen
 * can import by paste. Width and height are in arcmin.
 */
export function telescopiusCsv({ centre, pa, cols, rows, overlap, fov }) {
  const panels = mosaicPanels({ centre, pa, cols, rows, overlap, fov });
  const w = (fov.width * 60).toFixed(2);
  const h = (fov.height * 60).toFixed(2);
  const ov = `${Math.round(overlap * 100)}%`;
  const signedPa = (a) => {
    const x = ((a + 180) % 360 + 360) % 360 - 180; // -180..180, like Telescopius
    return (Math.abs(x) < 0.005 ? 0 : x).toFixed(2);
  };
  const lines = ['Pane, RA, DEC, Position Angle (East), Pane width (arcmins), Pane height (arcmins), Overlap, Row, Column'];
  lines.push(
    ['Center', formatRaTelescopius(centre.ra), formatDecTelescopius(centre.dec), signedPa(pa), w, h, ov, '-', '-'].join(', '),
  );
  for (const p of panels) {
    lines.push(
      [`Pane ${p.index}`, formatRaTelescopius(p.ra), formatDecTelescopius(p.dec), signedPa(p.pa), w, h, ov, p.row, p.col].join(', '),
    );
  }
  return lines.join('\n');
}
