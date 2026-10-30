/**
 * A small map of the Moon's near side, drawn in code (an original, simplified drawing): a grey
 * disc, the large dark lava plains as soft shapes, and a dot at a landing site. It answers
 * "where on the Moon is this?" on the site picker and the debrief.
 *
 * Projection: orthographic, seen from the Earth. x = cos(lat) sin(lon), y = sin(lat).
 */

/** Large dark plains: centre latitude and east longitude (deg), half sizes (deg). */
const PLAINS: readonly { lat: number; lon: number; rx: number; ry: number }[] = [
  { lat: 33, lon: -16, rx: 10, ry: 9 },
  { lat: 28, lon: 17.5, rx: 6.5, ry: 6 },
  { lat: 8.5, lon: 31, rx: 8, ry: 7 },
  { lat: 17, lon: 59, rx: 4.5, ry: 4 },
  { lat: -7.8, lon: 51.3, rx: 6, ry: 7 },
  { lat: -15, lon: 35, rx: 3.5, ry: 3.5 },
  { lat: -21, lon: -16.6, rx: 7, ry: 6 },
  { lat: -24.4, lon: -38.6, rx: 4, ry: 3.5 },
  { lat: 25, lon: -55, rx: 11, ry: 14 },
  { lat: 2, lon: -42, rx: 10, ry: 9 },
  { lat: -10, lon: -23, rx: 4.5, ry: 4 },
  { lat: 56, lon: 1, rx: 22, ry: 3.5 },
  { lat: 13, lon: 4, rx: 4, ry: 3 },
];

const RAD = Math.PI / 180;

/** East longitude (0..360 or -180..180) to -180..180. */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Map point (x right, y up, unit disc) of a near-side latitude and longitude (deg). */
export function projectNearSide(lat: number, lon: number): { x: number; y: number } {
  const phi = lat * RAD;
  const lam = wrapLon(lon) * RAD;
  return { x: Math.cos(phi) * Math.sin(lam), y: Math.sin(phi) };
}

const f = (v: number): string => v.toFixed(3);

/** SVG markup of the map with a dot at the site. Decorative unless a label is given. */
export function moonMapSvg(lat: number, lon: number, className = 'mt-moon-map', label?: string): string {
  const plains = PLAINS.map((p) => {
    const c = projectNearSide(p.lat, p.lon);
    // Foreshortening toward the rim.
    const rx = Math.max(0.02, p.rx * RAD * Math.cos(wrapLon(p.lon) * RAD));
    const ry = Math.max(0.02, p.ry * RAD * Math.cos(p.lat * RAD));
    return `<ellipse cx="${f(c.x)}" cy="${f(-c.y)}" rx="${f(rx)}" ry="${f(ry)}"/>`;
  }).join('');
  const site = projectNearSide(lat, lon);
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true" focusable="false"';
  return (
    `<svg class="${className}" viewBox="-1.12 -1.12 2.24 2.24" ${a11y}>` +
    '<circle r="1" fill="#d8d2c6"/>' +
    `<g fill="#8f887d" opacity="0.85">${plains}</g>` +
    '<circle r="1" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="0.06"/>' +
    `<circle cx="${f(site.x)}" cy="${f(-site.y)}" r="0.16" fill="#ff6b6b" stroke="#fff7e6" stroke-width="0.06"/>` +
    '</svg>'
  );
}
