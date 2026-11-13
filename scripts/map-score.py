# The island as a map (4.9 part 3): scores a reading of the island-whole frames
# (a JSON written from the frames alone) against what the simulation held
# (scripts/map-states.ts truth.json), with each village's place on the frame
# (scripts/map-frames.mjs proj-<seed>.json). Crop coordinates: the 2x frame from y=600.
#   python3 scripts/map-score.py <frames dir> <reading.json>
import json
import sys
from itertools import combinations

d, reading_path = sys.argv[1], sys.argv[2]
truth = json.load(open(f"{d}/states/truth.json"))
reading = json.load(open(reading_path))
tot = {"villages": 0, "found": 0, "size": 0, "hurt": 0, "building": 0, "pairs": 0, "pairs_ok": 0, "roads": 0, "roads_found": 0, "roads_false": 0}
for seed, t in truth.items():
    proj = {p["name"]: (p["x"], p["y"] - 600) for p in json.load(open(f"{d}/proj-{seed}.json"))}
    r = reading.get(seed, {"villages": [], "roads": []})
    used = set()
    match = {}
    for v in t["villages"]:
        px, py = proj[v["name"]]
        best, bd = None, 70
        for k, rv in enumerate(r["villages"]):
            if k in used:
                continue
            dd = ((rv["at"][0] - px) ** 2 + (rv["at"][1] - py) ** 2) ** 0.5
            if dd < bd:
                best, bd = k, dd
        hurt = v["rubble"] > 0 or v["burning"] > 0
        building = v["sites"] > 0
        tot["villages"] += 1
        line = f"  {v['name']:<10} {v['tier']:<8} houses {v['houses']:>3} people {v['people']:>3} hurt {str(hurt):<5} building {str(building):<5}"
        if best is None:
            print(line, "-> not found")
            continue
        used.add(best)
        match[v["name"]] = best
        rv = r["villages"][best]
        tot["found"] += 1
        tot["size"] += rv["tier"] == v["tier"]
        tot["hurt"] += rv["hurt"] == hurt
        tot["building"] += rv["building"] == building
        print(line, f"-> read {rv['tier']}, hurt {rv['hurt']}, building {rv['building']}")
    # Roads: a pair of villages joined by a road at least half laid.
    joined = set()
    for road in t["roads"]:
        if road["laid"] >= 50 and road["a"] in proj and road["b"] in proj:
            joined.add(frozenset((road["a"], road["b"])))
    said = set()
    for a, b in r["roads"]:
        ends = []
        for p in (a, b):
            k = min(range(len(r["villages"])), key=lambda k: (r["villages"][k]["at"][0] - p[0]) ** 2 + (r["villages"][k]["at"][1] - p[1]) ** 2)
            name = next((n for n, m in match.items() if m == k), None)
            ends.append(name)
        if None not in ends:
            said.add(frozenset(ends))
    names = [v["name"] for v in t["villages"]]
    for pair in combinations(names, 2):
        p = frozenset(pair)
        tot["pairs"] += 1
        tot["pairs_ok"] += (p in joined) == (p in said)
    tot["roads"] += len(joined)
    tot["roads_found"] += len(joined & said)
    tot["roads_false"] += len(said - joined)
    print(f"seed {seed}: roads joined {[sorted(p) for p in joined]}, read {[sorted(p) for p in said]}; unlaid or wonder roads {[(x['a'], x['b'], x['laid']) for x in t['roads'] if frozenset((x['a'], x['b'])) not in joined]}")
n = tot["villages"]
print(
    f"villages {n}, found {tot['found']}; size {tot['size']}/{n} = {round(100 * tot['size'] / n)}%; hurt {tot['hurt']}/{n} = {round(100 * tot['hurt'] / n)}%; "
    f"building {tot['building']}/{n} = {round(100 * tot['building'] / n)}%; road pairs right {tot['pairs_ok']}/{tot['pairs']}; roads found {tot['roads_found']}/{tot['roads']}, false {tot['roads_false']}"
)
