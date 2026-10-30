# Cuts 256x256 height windows (30 m spacing) around real landing sites from NASA LRO LOLA LDEM_1024 (public domain, PDS).
import math, struct, json, urllib.request, numpy as np, sys
BASE = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/"
import os
PPD = int(os.environ.get("PPD","512")); N = 256; SPACING = float(os.environ.get("SP","60")); BAND = {1024:(15,30),512:(45,90),256:(90,180)}[PPD]; R = 1737400.0
SITES = [
  ("tranquility", "Sea of Tranquility", 0.6741, 23.4730),
  ("storms", "Ocean of Storms", -3.0124, 336.5784),
  ("fra-mauro", "Fra Mauro Highlands", -3.6453, 342.5286),
  ("descartes", "Descartes Highlands", -8.9730, 15.5002),
  ("taurus-littrow", "Taurus-Littrow Valley", 20.1911, 30.7723),
  ("hadley", "Hadley Rille", 26.1322, 3.6339),
]
def tile_for(lat, lon):
    B, L = BAND
    b = math.floor(lat / B) * B; l0 = math.floor(lon / L) * L
    ns = lambda v: f"{abs(v):02d}{'n' if v > 0 else ('s' if v < 0 else ('n' if b >= 0 else 's'))}"
    name = f"ldem_{PPD}_{ns(b)}_{ns(b+B)}_{l0:03d}_{l0+L:03d}.img"
    return name, b + B, l0  # top latitude, west longitude
def fetch_rows(url, r0, r1):
    req = urllib.request.Request(url, headers={"Range": f"bytes={r0*PPD*BAND[1]*2}-{r1*PPD*BAND[1]*2-1}"})
    data = urllib.request.urlopen(req, timeout=120).read()
    return np.frombuffer(data, dtype="<i2").reshape(r1 - r0, PPD * BAND[1])
out = []
for slug, name, lat, lon in SITES:
    tname, top, west = tile_for(lat, lon)
    url = BASE + tname
    half_m = SPACING * (N - 1) / 2
    dlat = math.degrees(half_m / R); dlon = math.degrees(half_m / (R * math.cos(math.radians(lat))))
    rA = int(math.floor((top - (lat + dlat)) * PPD)) - 2; rB = int(math.ceil((top - (lat - dlat)) * PPD)) + 3
    rows = fetch_rows(url, rA, rB).astype(np.float64) * 0.5
    # bilinear sample on a local east/north grid centred on the site
    xs = (np.arange(N) - (N - 1) / 2) * SPACING
    E, Nn = np.meshgrid(xs, -xs)  # row 0 = north
    la = lat + np.degrees(Nn / R); lo = lon + np.degrees(E / (R * np.cos(np.radians(lat))))
    fr = (top - la) * PPD - 0.5 - rA; fc = (lo - west) * PPD - 0.5
    r0 = np.floor(fr).astype(int); c0 = np.floor(fc).astype(int); tr = fr - r0; tc = fc - c0
    g = lambda r, c: rows[r, c]
    h = (g(r0, c0) * (1 - tr) * (1 - tc) + g(r0 + 1, c0) * tr * (1 - tc) + g(r0, c0 + 1) * (1 - tr) * tc + g(r0 + 1, c0 + 1) * tr * tc)
    centre = float(h[N // 2, N // 2]); rel = np.round((h - centre) * 2).astype("<i2")  # 0.5 m units relative to the site
    rel.tofile(f"{slug}.bin")
    info = dict(slug=slug, name=name, lat=lat, lon=lon, tile=tname, size=N, spacing=SPACING, unit=0.5,
                min=float(h.min() - centre), max=float(h.max() - centre), std=float(h.std()))
    print(json.dumps(info)); out.append(info)
json.dump(dict(source=BASE, product=f"LRO LOLA LDEM_{PPD} (gridded elevation, {PPD} px/deg)", licence="Public domain (NASA)", sites=out), open("sites.json", "w"), indent=1)
