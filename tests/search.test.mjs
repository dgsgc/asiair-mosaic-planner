import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogueName, nameIndex, findLocal, sesameQueries } from '../src/search.js';

const names = JSON.parse(readFileSync(new URL('../data/names.json', import.meta.url))).names;
const own = JSON.parse(readFileSync(new URL('../data/nebulae.json', import.meta.url)));
const index = nameIndex(names);

test('catalogue names are tidied however they are typed', () => {
  for (const q of ['Sh2-155', 'sh2 155', 'SH2155', 'Sh 2-155', 'sharpless 155']) assert.equal(catalogueName(q)?.label, 'Sh2-155', q);
  assert.equal(catalogueName('m 31').label, 'M31');
  assert.equal(catalogueName('ngc7000').label, 'NGC 7000');
  assert.equal(catalogueName('b33').sesame, 'Barnard 33');
  assert.equal(catalogueName('Barnard 33').label, 'B 33');
  assert.equal(catalogueName('ldn1251').label, 'LDN 1251');
  assert.equal(catalogueName('vdb 152').label, 'vdB 152');
  assert.equal(catalogueName('Wolf-Rayet 134').label, 'WR 134');
  assert.equal(catalogueName('Soul Nebula'), null);
});

test('common names are found with or without Nebula, apostrophes or case', () => {
  for (const [q, want] of [
    ['soul', 'Soul Nebula'], ['Soul Nebula', 'Soul Nebula'], ['elephants trunk', "Elephant's Trunk Nebula"],
    ["Elephant's Trunk", "Elephant's Trunk Nebula"], ['pacman', 'Pacman Nebula'], ['Pac-Man Nebula', 'Pacman Nebula'],
    ['horsehead', 'Horsehead Nebula'], ['ROSETTE', 'Rosette Nebula'], ['Veil', 'Veil Nebula'],
    ['double cluster', 'Double Cluster'], ["markarian's chain", "Markarian's Chain"], ['barnards loop', "Barnard's Loop"],
  ]) assert.equal(findLocal(q, index, own)?.name, want, q);
});

test('the Cave Nebula is Sh2-155', () => {
  const cave = findLocal('Cave Nebula', index, own);
  assert.equal(cave.desig, 'Sh2-155');
  assert.ok(Math.abs(cave.ra - 344.27) < 0.1 && Math.abs(cave.dec - 62.64) < 0.1);
});

test('Sharpless, Barnard and Lynds numbers come from the bundled catalogues', () => {
  assert.equal(findLocal('sh2 155', index, own).name, 'Sh2-155');
  assert.equal(findLocal('B33', index, own).name, 'B 33');
  assert.ok(findLocal('LDN 1251', index, own));
  assert.ok(findLocal('lbn 437', index, own));
  assert.equal(findLocal('NGC 7000', index, own), null); // left to the name service
});

test('Sesame is asked the tidy name, or with Nebula and Galaxy added', () => {
  assert.deepEqual(sesameQueries('ngc7000'), [{ ask: 'NGC 7000', name: 'NGC 7000' }]);
  assert.deepEqual(sesameQueries('Tulip').map((s) => s.ask), ['Tulip', 'Tulip Nebula', 'Tulip Galaxy']);
  assert.deepEqual(sesameQueries('Crab Nebula').map((s) => s.ask), ['Crab Nebula']);
});

test('every common name has a sensible position', () => {
  for (const [name, ra, dec] of names) assert.ok(ra >= 0 && ra < 360 && Math.abs(dec) <= 90, name);
});
