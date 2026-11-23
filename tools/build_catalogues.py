#!/usr/bin/env python3
"""Builds data/nebulae.json: the Sharpless, LBN, LDN and Barnard catalogues.

Positions are J2000 as computed by VizieR (CDS). Run it again only to refresh
the file; the planner itself never asks VizieR. Uses the Harvard copy of
VizieR, falling back to CDS.

    python3 tools/build_catalogues.py
"""
import csv
import io
import json
import pathlib
import urllib.parse
import urllib.request

SERVERS = ["https://vizier.cfa.harvard.edu/viz-bin/asu-tsv", "https://vizier.cds.unistra.fr/viz-bin/asu-tsv"]

# catalogue id in the file -> (VizieR table, name column, size column or None)
CATALOGUES = {
    "sh2": ("VII/20", "Sh2", "Diam"),
    "lbn": ("VII/9", "Seq", "Diam1"),
    "ldn": ("VII/7A", "LDN", None),
    "b": ("VII/220A", "Barn", "Diam"),
}


def fetch(table, cols):
    query = urllib.parse.urlencode({
        "-source": table,
        "-out.max": "unlimited",
        "-out": ",".join(cols),
        "-out.add": "_RAJ2000,_DEJ2000",
        "-oc.form": "d",
    })
    last = None
    for server in SERVERS:
        try:
            with urllib.request.urlopen(f"{server}?{query}", timeout=120) as r:
                return r.read().decode("utf-8")
        except OSError as e:
            last = e
    raise last


def rows(text):
    lines = [l for l in text.splitlines() if l and not l.startswith("#")]
    # header, units, dashes, then data
    header = lines[0].split("\t")
    for line in lines[3:]:
        yield dict(zip(header, (v.strip() for v in line.split("\t"))))


def main():
    out = {
        "source": "VizieR (CDS): VII/20 Sharpless 1959, VII/9 Lynds 1965 (LBN), VII/7A Lynds 1962 (LDN), VII/220A Barnard 1927",
        "format": "[name, RA J2000 deg, Dec J2000 deg, size arcmin or null]",
    }
    for key, (table, name_col, size_col) in CATALOGUES.items():
        cols = [name_col] + ([size_col] if size_col else [])
        items = []
        for row in rows(fetch(table, cols)):
            try:
                ra, dec = round(float(row["_RAJ2000"]), 4), round(float(row["_DEJ2000"]), 4)
            except (KeyError, ValueError):
                continue
            size = None
            if size_col and row.get(size_col):
                try:
                    size = float(row[size_col])
                except ValueError:
                    pass
            items.append([row[name_col], ra, dec, size])
        out[key] = items
        print(f"{key}: {len(items)}")
    path = pathlib.Path(__file__).resolve().parent.parent / "data" / "nebulae.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"wrote {path} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
