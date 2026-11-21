import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraFov, fromTangent, toTangent, bearing, separation, mosaicPanels, frameCorners,
  telescopiusCsv, formatRaTelescopius, formatDecTelescopius, parseRa, parseDec, mosaicExtent,
  formatRaAsiair, formatDecAsiair, asiairPlanText, sequenceSeconds, formatDuration,
  asiairToPa, paToAsiair, senderFile, orderPanels, rigPlanUrl,
} from '../src/mosaic.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (±${tol})`);

test('camera field of view from sensor and focal length', () => {
  // ASI533 (3008×3008 at 3.76 µm) on a 714 mm scope: plate solves gave 0.907°.
  const f = cameraFov({ focalLength: 714.3, pixelSize: 3.76, sensorWidthPx: 3008, sensorHeightPx: 3008 });
  near(f.width, 0.907, 0.002);
  near(f.scale, 1.086, 0.001);
});

test('tangent projection round trip, including near the pole and RA wrap', () => {
  for (const [ra0, dec0, xi, eta] of [[10, 20, 1.2, -0.7], [359.5, 0, 1, 1], [0.2, 0, -1, 0.3], [120, 88, 2, 1.5], [200, -60, -0.5, 2]]) {
    const p = fromTangent(ra0, dec0, xi, eta);
    const t = toTangent(ra0, dec0, p.ra, p.dec);
    near(t.xi, xi, 1e-9);
    near(t.eta, eta, 1e-9);
  }
});

test('bearing: north is 0, east is 90', () => {
  near(bearing(100, 10, 100, 11), 0, 1e-9);
  near(bearing(100, 0, 101, 0), 90, 1e-9);
  near(bearing(100, 0, 99, 0), 270, 1e-9);
});

test('single panel at PA 0 has its top edge north and its first corner to the east', () => {
  const [tl, tr, br, bl] = frameCorners(50, 30, 0, 1, 0.5);
  assert.ok(tl[1] > 30 && tr[1] > 30 && br[1] < 30 && bl[1] < 30);
  assert.ok(tl[0] > 50, 'top-left is east (higher RA) with east on the left');
  assert.ok(tr[0] < 50);
});

test('matches a real Telescopius export (2 wide × 1 high, 100.8′ panes, 10%)', () => {
  // From a Telescopius CSV quoted in KDE bug 465483:
  //   Center, 04hr 01' 17", 36º 17' 44", 0.00, 100.80, 100.80, 10%, -, -
  //   Pane 1, 04hr 05' 02", 36º 17' 31", 0.56, 100.80, 100.80, 10%, 1, 1
  //   Pane 2, 03hr 57' 31", 36º 17' 31", -0.56, 100.80, 100.80, 10%, 1, 2
  const centre = { ra: parseRa('04 01 17'), dec: parseDec('36 17 44') };
  const fov = { width: 100.8 / 60, height: 100.8 / 60 };
  const [p1, p2] = mosaicPanels({ centre, pa: 0, cols: 2, rows: 1, overlap: 0.1, fov });
  near(p1.ra, parseRa('04 05 02'), 2 / 240, 'pane 1 RA'); // within 2 s of time
  near(p2.ra, parseRa('03 57 31'), 2 / 240, 'pane 2 RA');
  near(p1.dec, parseDec('36 17 31'), 2 / 3600, 'pane 1 Dec');
  near(p2.dec, parseDec('36 17 31'), 2 / 3600, 'pane 2 Dec');
  const signed = (a) => ((a + 180) % 360) - 180;
  near(signed(p1.pa), 0.56, 0.02, 'pane 1 PA');
  near(signed(p2.pa), -0.56, 0.02, 'pane 2 PA');
});

test('neighbouring panels overlap by the requested amount', () => {
  const fov = { width: 1.0, height: 0.7 };
  const panels = mosaicPanels({ centre: { ra: 80, dec: -5 }, pa: 35, cols: 3, rows: 2, overlap: 0.2, fov });
  assert.equal(panels.length, 6);
  near(separation(panels[0].ra, panels[0].dec, panels[1].ra, panels[1].dec), 0.8, 0.002, 'column step');
  near(separation(panels[0].ra, panels[0].dec, panels[3].ra, panels[3].dec), 0.56, 0.002, 'row step');
  const ext = mosaicExtent({ cols: 3, rows: 2, overlap: 0.2, fov });
  near(ext.width, 2.6, 1e-9);
  near(ext.height, 1.26, 1e-9);
});

test('rotation by 90° turns a row of panels north–south', () => {
  const [a, b] = mosaicPanels({ centre: { ra: 10, dec: 0 }, pa: 90, cols: 2, rows: 1, overlap: 0, fov: { width: 1, height: 1 } });
  near(a.ra, b.ra, 1e-6);
  // At PA 90 the frame's top points east, so its left (column 1) points south.
  near(b.dec - a.dec, 1, 0.001);
});

test('Telescopius formatting carries rounding and signs', () => {
  assert.equal(formatRaTelescopius(parseRa('04 01 16.6')), `04hr 01' 17"`);
  assert.equal(formatRaTelescopius(parseRa('23 59 59.8')), `00hr 00' 00"`);
  assert.equal(formatDecTelescopius(-5.3911), `-05º 23' 28"`);
  assert.equal(formatDecTelescopius(-0.0000001), `00º 00' 00"`);
  assert.equal(formatDecTelescopius(parseDec('+36 17 59.7')), `36º 18' 00"`);
});

test('CSV has a header, a centre row and one row per pane', () => {
  const csv = telescopiusCsv({ centre: { ra: 60.3, dec: 36.3 }, pa: 0, cols: 2, rows: 1, overlap: 0.1, fov: { width: 1.68, height: 1.68 } });
  const lines = csv.split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^Pane, RA, DEC, Position Angle \(East\)/);
  assert.match(lines[1], /^Center, 04hr 01' 12", 36º 18' 00", 0\.00, 100\.80, 100\.80, 10%, -, -$/);
  assert.match(lines[2], /^Pane 1, .*, 1, 1$/);
});

test('ASIAIR plan text matches what the app shares and imports', () => {
  // Shared by the ASIAIR app (3.0.0) for a pasted 2x2 mosaic:
  //   Pane 1,21h 00m 33s,+44° 34′ 01″
  assert.equal(formatRaAsiair(parseRa('21 00 32.6')), '21h 00m 33s');
  assert.equal(formatDecAsiair(parseDec('44 34 01')), '+44° 34′ 01″');
  assert.equal(formatDecAsiair(-5.3911), '-05° 23′ 28″');
  assert.equal(formatDecAsiair(0), '+00° 00′ 00″');
  const fov = cameraFov({ focalLength: 1370, pixelSize: 3.8, sensorWidthPx: 4656, sensorHeightPx: 3520 });
  const text = asiairPlanText([
    { name: 'NGC 7000', centre: { ra: parseRa('20 58 47'), dec: parseDec('44 19 48') }, pa: 0, cols: 2, rows: 2, overlap: 0.15, fov },
    { name: 'M31, Andromeda', centre: { ra: 10.68, dec: 41.27 }, pa: 0, cols: 1, rows: 1, overlap: 0.15, fov },
  ]);
  const lines = text.split('\n');
  assert.equal(lines[0], 'Name,RA,DEC,Angle');
  assert.equal(lines.length, 1 + 4 + 1, 'no centre row');
  // Same panel positions as the Telescopius export the app accepted in the trial.
  assert.equal(lines[1], 'NGC 7000_1-1,21h 00m 33s,+44° 34′ 01″,');
  assert.equal(lines[4], 'NGC 7000_2-2,20h 57m 02s,+44° 05′ 29″,');
  assert.equal(lines[5], 'M31 Andromeda,00h 42m 43s,+41° 16′ 12″,', 'single frame keeps its name, commas removed');
  assert.ok(!/['"]/.test(text), 'no ASCII quote marks');
});

test('ASIAIR angles convert to position angles', () => {
  // The app's sky atlas at "Rotation 148.8°" drew a 0.74° × 0.56° frame with its
  // long edges along PA 122.7°/302.7° and its top at PA ≈ 32°.
  near(asiairToPa(148.8), 31.2, 1e-9);
  near(asiairToPa(93), 87, 1e-9);
  near(asiairToPa(0), 180, 1e-9);
  near(asiairToPa(180), 0, 1e-9);
  near(asiairToPa(270), 270, 1e-9);
  for (const a of [0, 12.5, 148.8, 300]) near(paToAsiair(asiairToPa(a)), a, 1e-9);
  // Long side of a frame at ASIAIR 148.8° runs along PA ≈ 122.7°.
  const [tl, tr] = frameCorners(355.1, 44.33, asiairToPa(148.8), 0.74, 0.56);
  near(bearing(tl[0], tl[1], tr[0], tr[1]) % 180, 121.2, 1.5);
});

test('send file for the ASIAIR Plan Sender', () => {
  const fov = { width: 0.74, height: 0.56 };
  const f = senderFile([
    { name: 'NGC 7000', target: { name: 'NGC 7000', centre: { ra: 314.7, dec: 44.3 }, pa: 31.2, cols: 2, rows: 1, overlap: 0.15, fov },
      exposures: [{ type: 'Light', exp: 300, gain: '', repeat: 10, bin: 2 }, { type: 'Light', exp: 0, repeat: 5, bin: 1 }] },
    { name: 'M33', target: { name: 'M33', centre: { ra: 23.46, dec: 30.66 }, pa: 0, cols: 1, rows: 1, overlap: 0.15, fov },
      exposures: [{ type: 'Dark', exp: 120, gain: 100, repeat: 20, bin: 1 }], angle: 148.84 },
  ], { created: '2026-11-18T12:00:00Z', rig: { name: 'Test', angle: 90 } });
  assert.equal(f.plans[0].angle, undefined, 'no angle given, none written');
  assert.equal(f.plans[1].angle, 148.8, 'camera angle, ASIAIR convention, 0.1° steps');
  assert.equal(f.rig.angle, 90);
  assert.equal(f.format, 'asiair-plan-sender');
  assert.equal(f.plans.length, 2);
  assert.equal(f.plans[0].targets.length, 2);
  assert.equal(f.plans[0].targets[0].name, 'NGC 7000_1-1');
  assert.match(f.plans[0].importText, /^Name,RA,DEC,Angle\nNGC 7000_1-1,/);
  assert.deepEqual(f.plans[0].exposures, [{ type: 'Light', exposure: 300, gain: null, count: 10, bin: 2 }], 'empty lines dropped, blank gain is null');
  assert.deepEqual(f.plans[1].exposures, [{ type: 'Dark', exposure: 120, gain: 100, count: 20, bin: 1 }]);
  assert.equal(f.plans[1].targets[0].name, 'M33');
});

test('panel order: row by row, or column by column back and forth', () => {
  const fov = { width: 1, height: 1 };
  const panels = mosaicPanels({ centre: { ra: 80, dec: 10 }, pa: 180, cols: 3, rows: 2, overlap: 0.2, fov });
  const names = (ps) => ps.map((p) => `${p.row}-${p.col}`).join(' ');
  assert.equal(names(orderPanels(panels)), '1-1 1-2 1-3 2-1 2-2 2-3');
  assert.equal(names(orderPanels(panels, 'serpentine')), '1-1 2-1 2-2 1-2 1-3 2-3');
  // Each step in the serpentine order is to a neighbouring panel.
  const s = orderPanels(panels, 'serpentine');
  for (let i = 1; i < s.length; i++) {
    assert.equal(Math.abs(s[i].row - s[i - 1].row) + Math.abs(s[i].col - s[i - 1].col), 1);
  }
  const f = senderFile([{ name: 'M', target: { name: 'M', centre: { ra: 80, dec: 10 }, pa: 180, cols: 3, rows: 2, overlap: 0.2, fov, order: 'serpentine' }, exposures: [] }]);
  assert.equal(f.plans[0].targets.map((t) => t.name).join(' '), 'M_1-1 M_2-1 M_2-2 M_1-2 M_1-3 M_2-3');
  assert.match(f.plans[0].importText, /^Name,RA,DEC,Angle\nM_1-1,.*\nM_2-1,/);
});

test('exposure totals', () => {
  assert.equal(sequenceSeconds([{ exp: 180, repeat: 20 }, { exp: 300, repeat: 10, enabled: false }, { exp: 60, repeat: 5 }]), 3900);
  assert.equal(formatDuration(3900), '1h 5m');
  assert.equal(formatDuration(1800), '30m');
  assert.equal(formatDuration(7200), '2h');
});

test('parsing coordinates people type', () => {
  near(parseRa('5h35m17.3s'), 83.822, 0.001);
  near(parseRa('05:35:17.3'), 83.822, 0.001);
  near(parseRa('83.822'), 83.822, 1e-9);
  near(parseDec('-5°23\'28"'), -5.3911, 0.0001);
  near(parseDec('−05 23 28'), -5.3911, 0.0001);
  assert.ok(Number.isNaN(parseDec('abc')));
});

test('Star Adventurer controller address becomes its /plan URL', () => {
  assert.equal(rigPlanUrl(''), 'http://rig.local/plan');
  assert.equal(rigPlanUrl(undefined), 'http://rig.local/plan');
  assert.equal(rigPlanUrl('rig.local'), 'http://rig.local/plan');
  assert.equal(rigPlanUrl(' http://rig.local/ '), 'http://rig.local/plan');
  assert.equal(rigPlanUrl('10.0.0.5:8080'), 'http://10.0.0.5:8080/plan');
  assert.equal(rigPlanUrl('http://10.0.0.5:8080/plan'), 'http://10.0.0.5:8080/plan');
  assert.equal(rigPlanUrl('HTTPS://example.test'), 'HTTPS://example.test/plan');
});
