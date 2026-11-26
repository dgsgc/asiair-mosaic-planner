// Finding a target by name. The planner first looks in its own lists (common
// names in data/names.json, and the Sharpless, LBN, LDN and Barnard
// catalogues in data/nebulae.json), then asks the Sesame name service. Names
// are tidied first, so "sh2 155", "Sh 2-155" and "Sharpless 155" all work.

/** Lower case, with spaces, apostrophes and other punctuation taken out. */
export const squash = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9+\-−]/g, '').replace(/[-−]/g, '');

const ENDINGS = /(nebulae|nebula|galaxy|cluster|complex|region)$/;

// How each catalogue is typed, written, and asked of Sesame.
const CATALOGUES = [
  { re: /^(?:m|messier)\s*(\d{1,3})$/i, label: (n) => `M${n}`, sesame: (n) => `M ${n}` },
  { re: /^ngc\s*(\d{1,4}[a-z]?)$/i, label: (n) => `NGC ${n.toUpperCase()}` },
  { re: /^ic\s*(\d{1,4}[a-z]?)$/i, label: (n) => `IC ${n.toUpperCase()}` },
  { re: /^(?:sh\s*2|sh2|sharpless)\s*[-–]?\s*(\d{1,3})$/i, label: (n) => `Sh2-${n}`, own: 'sh2' },
  { re: /^(?:b|barnard)\s*(\d{1,3}[a-z]?)$/i, label: (n) => `B ${n}`, sesame: (n) => `Barnard ${n}`, own: 'b' },
  { re: /^(?:ldn|lynds\s*dark(?:\s*nebula)?)\s*(\d{1,4})$/i, label: (n) => `LDN ${n}`, own: 'ldn' },
  { re: /^(?:lbn|lynds\s*bright(?:\s*nebula)?)\s*(\d{1,4})$/i, label: (n) => `LBN ${n}`, own: 'lbn' },
  { re: /^(?:vdb|van\s*den\s*bergh)\s*(\d{1,3})$/i, label: (n) => `vdB ${n}` },
  { re: /^(?:ced|cederblad)\s*(\d{1,3}[a-z]?)$/i, label: (n) => `Ced ${n}` },
  { re: /^rcw\s*(\d{1,3})$/i, label: (n) => `RCW ${n}` },
  { re: /^(?:c|caldwell)\s*(\d{1,3})$/i, label: (n) => `Caldwell ${n}` },
  { re: /^(?:cr|collinder)\s*(\d{1,3})$/i, label: (n) => `Collinder ${n}` },
  { re: /^(?:mel|melotte)\s*(\d{1,3})$/i, label: (n) => `Melotte ${n}` },
  { re: /^(?:abell|aco)\s*(\d{1,4})$/i, label: (n) => `Abell ${n}` },
  { re: /^(?:ugc)\s*(\d{1,5})$/i, label: (n) => `UGC ${n}` },
  { re: /^(?:pgc)\s*(\d{1,7})$/i, label: (n) => `PGC ${n}` },
  { re: /^(?:arp)\s*(\d{1,3})$/i, label: (n) => `Arp ${n}` },
  { re: /^(?:hcg)\s*(\d{1,3})$/i, label: (n) => `HCG ${n}` },
  { re: /^(?:wr|wolf[\s-]*rayet)\s*(\d{1,3})$/i, label: (n) => `WR ${n}` },
  { re: /^(?:pn\s*)?(?:abell|a66)\s*(\d{1,2})\s*pn$/i, label: (n) => `PN A66 ${n}` },
];

/** A catalogue designation in its usual form, or null: "sh2 155" → Sh2-155. */
export function catalogueName(query) {
  const q = String(query).trim().replace(/\s+/g, ' ');
  for (const c of CATALOGUES) {
    const m = q.match(c.re);
    if (m) {
      const label = c.label(m[1]);
      return { label, sesame: c.sesame ? c.sesame(m[1]) : label, own: c.own, num: m[1] };
    }
  }
  return null;
}

/** An index of the common names, by squashed name and alias. */
export function nameIndex(names) {
  const index = new Map();
  const add = (key, entry) => { if (key && !index.has(key)) index.set(key, entry); };
  for (const [name, ra, dec, desig, also = []] of names) {
    const entry = { name, ra, dec, desig };
    for (const n of [name, ...also]) {
      add(squash(n), entry);
      add(squash(n).replace(ENDINGS, ''), entry);
    }
  }
  return index;
}

/**
 * Look a name up in the planner's own lists. Returns { name, ra, dec, desig }
 * or null. `index` is from nameIndex(); `own` is data/nebulae.json.
 */
export function findLocal(query, index, own) {
  const q = squash(query);
  if (!q) return null;
  const hit = index?.get(q) || index?.get(q.replace(ENDINGS, ''));
  if (hit) return hit;
  const cat = catalogueName(query);
  if (cat?.own && own?.[cat.own]) {
    const row = own[cat.own].find(([n]) => String(n).toLowerCase() === cat.num.toLowerCase());
    if (row) return { name: cat.label, ra: row[1], dec: row[2], desig: cat.label };
  }
  return null;
}

/**
 * What to ask Sesame, in order: the tidied designation, or the text as typed,
 * then with "Nebula" or "Galaxy" added (Sesame knows "Veil Nebula" but not
 * "Veil"). Each comes with the name to give the target.
 */
export function sesameQueries(query) {
  const q = String(query).trim().replace(/\s+/g, ' ');
  const cat = catalogueName(q);
  if (cat) return [{ ask: cat.sesame, name: cat.label }];
  const out = [{ ask: q, name: q }];
  if (!ENDINGS.test(squash(q))) {
    for (const end of ['Nebula', 'Galaxy']) out.push({ ask: `${q} ${end}`, name: `${q} ${end}` });
  }
  return out;
}
