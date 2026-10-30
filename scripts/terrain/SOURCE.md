# Moon terrain data

- Product: NASA Lunar Reconnaissance Orbiter, Lunar Orbiter Laser Altimeter (LOLA) gridded elevation, LDEM_512 (512 px/deg, about 59 m/px), PDS bundle urn:nasa:pds:lro_lola_rdr (DOI 10.17189/tnyt-7007), Smith, D.E. and Neumann, G.A.
- Downloaded from https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ with HTTP range reads (only the rows around each site).
- Licence: public domain. PDS Geosciences FAQ: "Data sets archived in the PDS are in the public domain" (https://pds-geosciences.wustl.edu/faq.html). NASA Science Data Portal: data from NASA-led missions are CC0 unless marked otherwise (https://science.data.nasa.gov/about/license). No NASA logos or endorsement implied.
- Processing (scripts/terrain/fetch.py): bilinear resample to a 256 x 256 local grid at 60 m spacing (15.3 km square) centred on each site; a 1D Gaussian (sigma 1.6 px) across columns softens LOLA ground-track striping; heights are relative to the site centre in 0.5 m units, int16 little-endian, row 0 = north.
