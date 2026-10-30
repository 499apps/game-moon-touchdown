/**
 * Original Moon Touchdown icons (24x24, stroke based, the same style as the kit icons). They
 * carry the meaning without words: a lander, a crater map for sites, a small lander held in a
 * cupped hand for the hover helper, a slider and a pad for the touch controls.
 */

const paths = {
  lander:
    '<path d="M8.5 4.5h7l1.5 4h-10z"/><path d="M6 8.5h12v4H6z"/><path d="m7.5 12.5-3 6"/><path d="m16.5 12.5 3 6"/><path d="M3 18.5h3"/><path d="M18 18.5h3"/><path d="M10.5 12.5 12 15l1.5-2.5"/>',
  sites:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="9.5" r="2"/><circle cx="15" cy="14" r="2.6"/><circle cx="8.5" cy="15.5" r="1.1"/>',
  assist:
    '<path d="M10 3h4l1 2.5H9z"/><path d="M8.5 5.5h7v3.5h-7z"/><path d="m9.5 9-1.5 2.5"/><path d="m14.5 9 1.5 2.5"/><path d="M3 13.5c1.6 4.2 5 6.5 9 6.5s7.4-2.3 9-6.5"/><path d="M3 13.5 5.2 12"/><path d="M21 13.5 18.8 12"/>',
  controls:
    '<rect x="3.5" y="4" width="4" height="16" rx="2"/><path d="M3.5 13h4"/><circle cx="16.5" cy="13" r="4.5"/><circle cx="16.5" cy="13" r="1.4"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.6"/><path d="M12 16.8h.01"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  next: '<path d="M5 12h13"/><path d="m13 6 6 6-6 6"/>',
  again: '<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v5h5"/>',
  play: '<path d="M7 5v14l11-7z"/>',
  close: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  boing: '<path d="M4 19.5h16"/><path d="M12 16.5c-3 0-3-2 0-2s3-2 0-2-3-2 0-2 3-2 0-2"/><circle cx="12" cy="5" r="2"/>',
  height: '<path d="M12 3.5v12"/><path d="m8.5 12 3.5 3.5 3.5-3.5"/><path d="M3.5 19.5h17"/><path d="m6 19.5 2-2.5 2 2.5"/>',
  down: '<path d="M12 4v15"/><path d="m6 13 6 6 6-6"/>',
  up: '<path d="M12 20V5"/><path d="m6 11 6-6 6 6"/>',
  fuel: '<path d="M6 20V6.5A2.5 2.5 0 0 1 8.5 4h4A2.5 2.5 0 0 1 15 6.5V20"/><path d="M4.5 20h12"/><path d="M8.5 8.5h4"/><path d="m15 9 3 2.5v5.5a1.5 1.5 0 0 0 3 0V9l-2.5-2.5"/>',
  drift: '<path d="M4 12h13"/><path d="m13 7 5 5-5 5"/>',
  tilt: '<circle cx="12" cy="12" r="8.5"/><circle cx="14.5" cy="10" r="2.2"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  earth: '<circle cx="12" cy="12" r="8.5"/><path d="M7 6.5c1.5 1 1 2.6 2.5 3.3 1.6.7 1.2 2.6 2.6 3.1"/><path d="M14.5 4.2c-.2 1.6 1 2.3 2.4 2.1"/><path d="M13 20c.3-1.8 1.8-2.4 3.3-2.6"/>',
} as const;

export type MoonIcon = keyof typeof paths;

export function moonIcon(name: MoonIcon, className = 'g499-icon-svg', filled = false): string {
  const fill = filled ? 'currentColor' : 'none';
  return `<svg class="${className}" viewBox="0 0 24 24" width="24" height="24" fill="${fill}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
