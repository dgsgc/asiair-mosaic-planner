#!/usr/bin/env python3
"""Builds data/names.json: common names of popular imaging targets.

The name services (Sesame: SIMBAD, NED, VizieR) don't know many of the names
imagers use ("Soul Nebula", "Pacman", "Elephant's Trunk"), and some names land
on the wrong object. This list maps each name to a catalogue designation,
looks the designation up once, and stores the position, so the planner finds
these names straight away, even when the name services are down.

Some entries give their own centre (RA, Dec in degrees) because they are
large areas or groups that no single catalogue entry describes well.

    /usr/bin/python3 tools/build_names.py
"""
import json
import pathlib
import re
import urllib.parse
import urllib.request

SESAME = ["https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-oI/SNV?", "https://cds.unistra.fr/cgi-bin/nph-sesame/-oI/SNV?"]

# (name shown, designation or (ra, dec), other names people type)
NAMES = [
    # Autumn and winter, northern sky
    ("Andromeda Galaxy", "M31", ["Andromeda"]),
    ("Triangulum Galaxy", "M33", ["Triangulum", "Pinwheel of Triangulum"]),
    ("Pleiades", "M45", ["Seven Sisters"]),
    ("Heart Nebula", "IC 1805", ["Heart"]),
    ("Soul Nebula", "Sh2-199", ["Soul", "Embryo Nebula"]),
    ("Heart and Soul", (40.6, 61.0), ["Heart and Soul Nebulae"]),
    ("Fishhead Nebula", "IC 1795", ["Fish Head Nebula"]),
    ("Double Cluster", (35.08, 57.14), ["NGC 869 and NGC 884", "h and chi Persei"]),
    ("Pacman Nebula", "NGC 281", ["Pacman", "Pac-Man Nebula"]),
    ("Bubble Nebula", "NGC 7635", ["Bubble"]),
    ("Lobster Claw Nebula", "Sh2-157", ["Lobster Claw"]),
    ("Cave Nebula", "Sh2-155", ["Cave"]),
    ("Wizard Nebula", "NGC 7380", ["Wizard"]),
    ("Elephant's Trunk Nebula", "IC 1396", ["Elephant's Trunk", "Elephant Trunk", "Elephants Trunk"]),
    ("Iris Nebula", "NGC 7023", ["Iris"]),
    ("Ghost Nebula", "vdB 141", ["Ghost of Cepheus"]),
    ("Flying Bat and Squid", (317.5, 60.0), ["Bat and Squid"]),
    ("Flying Bat Nebula", "Sh2-129", ["Flying Bat"]),
    ("Squid Nebula", (317.95, 59.98), ["Squid", "Ou4", "Ou 4"]),
    ("Lion Nebula", "Sh2-132", ["Lion"]),
    ("Shark Nebula", "LDN 1235", ["Shark"]),
    ("Fireworks Galaxy", "NGC 6946", ["Fireworks"]),
    ("Hidden Galaxy", "IC 342", []),
    ("Ghost of Cassiopeia", "IC 63", ["Gamma Cas Nebula", "IC 59 and IC 63"]),
    ("Little Dumbbell Nebula", "M76", ["Little Dumbbell"]),
    ("California Nebula", "NGC 1499", ["California"]),
    ("Flaming Star Nebula", "IC 405", ["Flaming Star"]),
    ("Tadpoles Nebula", "IC 410", ["Tadpoles", "Tadpole Nebula"]),
    ("Spaghetti Nebula", "Sh2-240", ["Spaghetti", "Simeis 147"]),
    ("Medusa Nebula", (112.26, 13.25), ["Medusa", "Abell 21", "Sh2-274"]),
    ("Jellyfish Nebula", "IC 443", ["Jellyfish"]),
    ("Monkey Head Nebula", "NGC 2174", ["Monkey Head"]),
    ("Crab Nebula", "M1", ["Crab"]),
    ("Rosette Nebula", "NGC 2244", ["Rosette"]),
    ("Cone Nebula", "NGC 2264", ["Cone", "Christmas Tree Cluster", "Fox Fur Nebula"]),
    ("Thor's Helmet", "NGC 2359", ["Thors Helmet"]),
    ("Seagull Nebula", "IC 2177", ["Seagull"]),
    ("Dolphin Head Nebula", "Sh2-308", ["Dolphin Head"]),
    ("Eskimo Nebula", "NGC 2392", ["Eskimo", "Clown Face Nebula"]),
    ("Orion Nebula", "M42", ["Orion", "Great Orion Nebula"]),
    ("Running Man Nebula", "NGC 1977", ["Running Man"]),
    ("Horsehead Nebula", "Barnard 33", ["Horsehead", "Horse Head Nebula"]),
    ("Flame Nebula", "NGC 2024", ["Flame"]),
    ("Orion's Belt", (83.0, -1.5), ["Orions Belt", "Horsehead and Flame"]),
    ("Barnard's Loop", "Sh2-276", ["Barnards Loop"]),
    ("Angelfish Nebula", "Sh2-264", ["Lambda Orionis Ring", "Angelfish"]),
    ("Witch Head Nebula", "IC 2118", ["Witch Head", "Witches Head"]),
    ("Beehive Cluster", "M44", ["Beehive", "Praesepe"]),
    # Spring galaxies
    ("Bode's Galaxy", "M81", ["Bodes Galaxy", "Bode's Nebula"]),
    ("Cigar Galaxy", "M82", ["Cigar"]),
    ("M81 and M82", (148.4, 69.35), ["Bode's and Cigar"]),
    ("Owl Nebula", "M97", ["Owl"]),
    ("Whirlpool Galaxy", "M51", ["Whirlpool"]),
    ("Pinwheel Galaxy", "M101", ["Pinwheel"]),
    ("Sunflower Galaxy", "M63", ["Sunflower"]),
    ("Black Eye Galaxy", "M64", ["Black Eye"]),
    ("Sombrero Galaxy", "M104", ["Sombrero"]),
    ("Leo Triplet", (169.75, 13.25), ["Hamburger Galaxy"]),
    ("Markarian's Chain", (186.75, 13.1), ["Markarians Chain", "Virgo Cluster"]),
    ("Needle Galaxy", "NGC 4565", ["Needle"]),
    ("Whale Galaxy", "NGC 4631", ["Whale", "Whale and Hockey Stick"]),
    ("Hockey Stick Galaxy", "NGC 4656", ["Hockey Stick"]),
    ("Cat's Eye Nebula", "NGC 6543", ["Cats Eye"]),
    ("Hercules Cluster", "M13", ["Great Hercules Cluster"]),
    # Summer, Cygnus and the Milky Way core
    ("Veil Nebula", (312.75, 30.67), ["Veil", "Cygnus Loop"]),
    ("Eastern Veil", "NGC 6992", ["East Veil", "Network Nebula"]),
    ("Western Veil", "NGC 6960", ["West Veil", "Witch's Broom"]),
    ("Pickering's Triangle", "NGC 6979", ["Pickerings Triangle", "Pickering's Triangular Wisp"]),
    ("North America Nebula", "NGC 7000", ["North America"]),
    ("Pelican Nebula", "IC 5070", ["Pelican"]),
    ("North America and Pelican", (313.6, 44.3), []),
    ("Cocoon Nebula", "IC 5146", ["Cocoon"]),
    ("Crescent Nebula", "NGC 6888", ["Crescent"]),
    ("Tulip Nebula", "Sh2-101", ["Tulip"]),
    ("Sadr Region", "IC 1318", ["Gamma Cygni Nebula", "Butterfly Nebula (Cygnus)", "Sadr"]),
    ("Dumbbell Nebula", "M27", ["Dumbbell"]),
    ("Ring Nebula", "M57", ["Ring"]),
    ("Coathanger", "Collinder 399", ["Brocchi's Cluster"]),
    ("Wild Duck Cluster", "M11", ["Wild Duck"]),
    ("Eagle Nebula", "M16", ["Eagle", "Pillars of Creation"]),
    ("Omega Nebula", "M17", ["Swan Nebula", "Omega", "Swan"]),
    ("Lagoon Nebula", "M8", ["Lagoon"]),
    ("Trifid Nebula", "M20", ["Trifid"]),
    ("Lagoon and Trifid", (271.6, -23.7), []),
    ("Butterfly Cluster", "M6", []),
    ("Ptolemy Cluster", "M7", []),
    ("Rho Ophiuchi", (246.4, -23.45), ["Rho Ophiuchi Cloud Complex", "Rho Oph"]),
    ("Blue Horsehead Nebula", "IC 4592", ["Blue Horsehead"]),
    ("Pipe Nebula", (262.0, -26.5), ["Pipe"]),
    ("Snake Nebula", "Barnard 72", ["Snake"]),
    ("Cat's Paw Nebula", "NGC 6334", ["Cats Paw"]),
    ("War and Peace Nebula", "NGC 6357", ["War and Peace", "Lobster Nebula"]),
    ("Prawn Nebula", "IC 4628", ["Prawn"]),
    ("Dragons of Ara", "NGC 6188", ["Fighting Dragons of Ara", "Rim Nebula"]),
    ("Helix Nebula", "NGC 7293", ["Helix", "Eye of God"]),
    # Southern sky
    ("Carina Nebula", "NGC 3372", ["Eta Carinae Nebula", "Eta Carinae", "Carina"]),
    ("Running Chicken Nebula", "IC 2944", ["Running Chicken", "Lambda Centauri Nebula"]),
    ("Statue of Liberty Nebula", "NGC 3576", ["Statue of Liberty"]),
    ("Pencil Nebula", "NGC 2736", ["Pencil"]),
    ("Vela Supernova Remnant", (128.5, -45.5), ["Vela SNR", "Vela"]),
    ("Gum Nebula", (127.0, -43.0), ["Gum 12"]),
    ("Tarantula Nebula", "NGC 2070", ["Tarantula", "30 Doradus"]),
    ("Large Magellanic Cloud", "LMC", ["LMC"]),
    ("Small Magellanic Cloud", "SMC", ["SMC"]),
    ("Omega Centauri", "NGC 5139", []),
    ("47 Tucanae", "NGC 104", ["47 Tuc"]),
    ("Centaurus A", "NGC 5128", ["Cen A"]),
    ("Sculptor Galaxy", "NGC 253", ["Silver Dollar Galaxy", "Silver Coin Galaxy"]),
    ("Southern Pinwheel Galaxy", "M83", ["Southern Pinwheel"]),
    ("Jewel Box", "NGC 4755", ["Kappa Crucis Cluster"]),
    ("Coalsack Nebula", (190.0, -63.0), ["Coalsack"]),
    ("Thackeray's Globules", "IC 2944", []),
    ("Skull and Crossbones Nebula", "NGC 2467", ["Skull and Crossbones"]),
]


def resolve(designation):
    last = None
    for base in SESAME:
        try:
            with urllib.request.urlopen(base + urllib.parse.quote(designation), timeout=30) as r:
                m = re.search(r"^%J\s+([\d.]+)\s+([+-][\d.]+)", r.read().decode(), re.M)
            if m:
                return round(float(m[1]), 4), round(float(m[2]), 4)
            last = LookupError(f"{designation}: not found")
        except OSError as e:
            last = e
    raise last


def main():
    out, missing = [], []
    for name, where, also in NAMES:
        if isinstance(where, tuple):
            ra, dec, desig = where[0], where[1], ""
        else:
            try:
                ra, dec = resolve(where)
            except (LookupError, OSError) as e:
                missing.append(f"{name}: {e}")
                continue
            desig = where
        out.append([name, ra, dec, desig, also])
        print(f"{name:30} {desig:14} {ra:9.4f} {dec:+8.4f}")
    if missing:
        raise SystemExit("Not found, fix these first:\n  " + "\n  ".join(missing))
    path = pathlib.Path(__file__).resolve().parent.parent / "data" / "names.json"
    path.write_text(json.dumps({
        "format": "[name, RA J2000 deg, Dec J2000 deg, designation, other names]",
        "names": out,
    }, separators=(",", ":"), ensure_ascii=False) + "\n")
    print(f"wrote {path} ({len(out)} names)")


if __name__ == "__main__":
    main()
