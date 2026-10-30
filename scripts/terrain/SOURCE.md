# Moon terrain data

- Product: NASA Lunar Reconnaissance Orbiter, Lunar Orbiter Laser Altimeter (LOLA) gridded elevation, LDEM_512 (512 px/deg, about 59 m/px), PDS bundle urn:nasa:pds:lro_lola_rdr (DOI 10.17189/tnyt-7007), Smith, D.E. and Neumann, G.A.
- Downloaded from https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ with HTTP range reads (only the rows around each site).
- Licence: public domain. PDS Geosciences FAQ: "Data sets archived in the PDS are in the public domain" (https://pds-geosciences.wustl.edu/faq.html). NASA Science Data Portal: data from NASA-led missions are CC0 unless marked otherwise (https://science.data.nasa.gov/about/license). No NASA logos or endorsement implied.
- Script: `scripts/terrain/fetch.py`. Only dependency: `numpy`. Defaults: `PPD=512`, `SP=60`, `SIGMA=1.6`.
- Processing, in the order the script does it:
  1. Read the LDEM rows around the site (int16, 0.5 m units).
  2. Bilinear resample to a 256 x 256 local east/north grid at 60 m spacing (15.3 km square), centred on the site. Row 0 = north.
  3. 1D Gaussian across columns (along each row, east-west), sigma 1.6 grid px, kernel radius 5 px, edge values repeated. It softens the north-south LOLA ground-track striping.
  4. Heights relative to the site centre, rounded to 0.5 m units, written as int16 little-endian (`<slug>.bin`).
  5. `sites.json`: product, source, licence, `processing` (the text of steps 2 to 4) and, per site, the tile, the grid, min, max, std and the `sha256` of the `.bin` bytes.

## Re-run pending (F-19)

Step 3, the `processing` field and the `sha256` values were added to the script in fix round F5, so that the script does what this file and `LICENSES.md` say. The committed `public/data/terrain/*.bin` files were not regenerated in F5, and they have no recorded hashes yet. Until a re-run, it is not proven that the committed files match the script.

To check (needs network access to the PDS server and `numpy`; this is a maintainer step, the game never downloads anything):

1. Make an empty folder outside `public/`, and run `python <repo>/scripts/terrain/fetch.py` in it.
2. Compare each new `<slug>.bin` with the committed file (same bytes, or the `sha256` in the new `sites.json`).
3. If they match, copy only the new `sites.json` (it adds the hashes). If they do not match, commit the new `.bin` files and `sites.json` together, then run `pnpm test` (the fuel tables use the terrain).
