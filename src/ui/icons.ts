/** Inline SVG icons (currentColor), so the UI ships without image files. One style: 24 px grid, 2 px round strokes. */
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
/** Solid shape inside a stroke icon. */
const SOLID = 'fill="currentColor" stroke="none"';

export const ICONS = {
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 20.5c1.2-3.8 4.3-5.5 8-5.5s6.800 1.700 8 5.500"/>'),
  cart: svg('<path d="M2.500 3.500h2.700l2.400 11h10.600l2.300-7.800H6.400"/><circle cx="9" cy="19" r="1.400"/><circle cx="17" cy="19" r="1.400"/>'),
  gear: svg(
    '<path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h9M19 18h1"/><circle cx="15" cy="6" r="2.200"/><circle cx="9" cy="12" r="2.200"/><circle cx="16" cy="18" r="2.200"/>',
  ),
  cash: svg('<rect x="2.500" y="6" width="19" height="12" rx="2.600"/><circle cx="12" cy="12" r="2.600"/><path d="M6.200 10v4M17.800 10v4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  video: svg(`<rect x="2.500" y="5" width="19" height="14" rx="3.200"/><path d="M10.200 9v6l5-3z" ${SOLID}/>`),
  left: svg('<path d="m15 5-7 7 7 7"/>'),
  right: svg('<path d="m9 5 7 7-7 7"/>'),
  back: svg('<path d="M20 12H5M11 6l-6 6 6 6"/>'),
  arrow: svg('<path d="M4 12h15M13 6l6 6-6 6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  speedo: svg(`<path d="M4.200 17.500a9 9 0 1 1 15.600 0"/><path d="m12 13 4-5"/><circle cx="12" cy="13" r="1.400" ${SOLID}/>`),
  trend: svg('<path d="M3.500 17 9 11.500l3.500 3.500 8-8M15 7h5.500v5.500"/>'),
  weight: svg('<circle cx="12" cy="5.500" r="2.200"/><path d="M8 8.500h8l3.200 11.500H4.800z"/>'),
  power: svg('<path d="M13 2.500 5 13.500h6l-1 8 8-11h-6z"/>'),
  timer: svg('<circle cx="12" cy="13.500" r="7.500"/><path d="M12 9.500v4l2.500 2M9.500 2.500h5"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/>'),
  drive: svg(
    '<rect x="3.500" y="3" width="4" height="6" rx="1.200"/><rect x="16.500" y="3" width="4" height="6" rx="1.200"/><rect x="3.500" y="15" width="4" height="6" rx="1.200"/><rect x="16.500" y="15" width="4" height="6" rx="1.200"/><path d="M7.500 6h9M7.500 18h9M12 6v12"/>',
  ),
  flag: svg('<path d="M5 21V4M5 4.500c4-2 6 2 10 0 1.400-.700 2.600-.900 4-.500v9c-1.400-.400-2.600-.200-4 .500-4 2-6-2-10 0"/>'),
  wrench: svg(
    '<path d="M15.200 6.300a4.600 4.600 0 0 0-6.100 5.700l-5.300 5.300a2 2 0 0 0 2.900 2.900l5.300-5.300a4.600 4.600 0 0 0 5.700-6.100l-2.900 2.900-2.500-.600-.600-2.500z"/>',
  ),
  paint: svg('<path d="M12 3s6 6.200 6 10.500a6 6 0 0 1-12 0C6 9.200 12 3 12 3z"/><path d="M9.500 14a2.600 2.600 0 0 0 2.500 2.600"/>'),
  rim: svg(
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.200"/><path d="M12 3v6.800M14.100 11.300l6.500-2.100M13.300 13.800l4 5.500M10.700 13.800l-4 5.500M9.900 11.300 3.400 9.200"/>',
  ),
  tint: svg('<path d="M3 16.500 7.500 8.600c.5-.9 1.400-1.400 2.400-1.400h7.300a2.800 2.800 0 0 1 2.800 2.800v6.500z"/><path d="M12 7.500v9"/>'),
  suspension: svg('<path d="M8 3h8M8 21h8M8.500 6.500l7 2-7 2.500 7 2.500-7 2.500 7 1.500"/>'),
  neon: svg(
    '<path d="M5 12.500 6.700 8.600A2.500 2.500 0 0 1 9 7h6a2.500 2.500 0 0 1 2.300 1.600l1.700 3.900"/><rect x="3" y="12.500" width="18" height="4" rx="1.600"/><path d="M5.500 20.500h2M11 20.500h2M16.500 20.500h2"/>',
  ),
  check: svg('<path d="m5 12.500 4.500 4.500L19 7.500"/>'),
  lock: svg('<rect x="5" y="10.500" width="14" height="10" rx="2.600"/><path d="M8.500 10.500v-3a3.500 3.500 0 0 1 7 0v3"/>'),
  pause: svg(`<rect x="6.500" y="5" width="3.800" height="14" rx="1.300" ${SOLID}/><rect x="13.700" y="5" width="3.800" height="14" rx="1.300" ${SOLID}/>`),
  play: svg(`<path d="M8 5.300v13.400a.8.8 0 0 0 1.200.7l10.800-6.700a.8.8 0 0 0 0-1.400L9.200 4.600a.8.8 0 0 0-1.200.7z" ${SOLID}/>`),
  restart: svg('<path d="M4.500 12a7.500 7.500 0 1 0 2.300-5.400"/><path d="M4.500 4.500V9H9"/>'),
  exit: svg('<path d="M10 4H6.500A2.500 2.500 0 0 0 4 6.500v11A2.500 2.500 0 0 0 6.500 20H10M15 8l4 4-4 4M19 12H9"/>'),
  off: svg('<circle cx="12" cy="12" r="8.500"/><path d="m6 6 12 12"/>'),
  garage: svg(
    '<path d="m5 11 1.600-4.300A2.500 2.500 0 0 1 9 5h6a2.500 2.500 0 0 1 2.400 1.700L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><path d="M6 17v2.500M18 17v2.500M7 14h1.500M15.500 14H17"/>',
  ),
  gamepad: svg('<rect x="2.500" y="7" width="19" height="10.500" rx="5.200"/><path d="M7.500 10.500v3.500M5.800 12.200h3.400M15 11.200h.01M18 13.300h.01"/>'),
  road: svg('<path d="M8 3 4.500 21M16 3l3.500 18M12 4v3M12 10.500v3M12 17v3.500"/>'),
  monitor: svg('<rect x="3" y="4.500" width="18" height="12" rx="2.200"/><path d="M8.500 20h7M12 16.500V20"/>'),
  trophy: svg(
    '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.500v1.200A3.600 3.600 0 0 0 8 10.800M16 6h3.500v1.200a3.600 3.600 0 0 1-3.500 3.600M12 13v4M8.500 20.500h7M9.500 17h5v3.500h-5z"/>',
  ),
  target: svg(`<circle cx="12" cy="12" r="8.500"/><circle cx="12" cy="12" r="4.500"/><circle cx="12" cy="12" r="1.200" ${SOLID}/>`),
  near: svg('<path d="M7 20V6M4 9l3-3 3 3M17 4v14M14 15l3 3 3-3"/>'),
  flame: svg('<path d="M12 2.500c.5 3.500 5.500 5.500 5.500 11a5.500 5.500 0 0 1-11 0c0-2 .8-3.400 1.800-4.500.3 1.500 1 2.300 1.900 2.700C9.800 8.500 10.500 5 12 2.500z"/>'),
  alert: svg('<path d="M12 4 2.800 19.500h18.400z"/><path d="M12 10v4.500M12 17.200v.01"/>'),
  pin: svg('<path d="M12 21s7-6.200 7-11.500a7 7 0 0 0-14 0C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/>'),
  sun: svg(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2.500v2M12 19.500v2M2.500 12h2M19.500 12h2M5.300 5.300l1.400 1.400M17.300 17.300l1.400 1.400M5.300 18.700l1.400-1.400M17.300 6.700l1.400-1.400"/>',
  ),
  sunset: svg('<path d="M3 18h18M6.500 21.500h11M7 18a5 5 0 0 1 10 0M12 6.500v3M4.800 10.800l1.800 1.800M19.200 10.800l-1.800 1.800"/>'),
  moon: svg('<path d="M20 14.500A8.500 8.500 0 1 1 9.500 4a7 7 0 0 0 10.500 10.500z"/>'),
  rain: svg('<path d="M7 15a4.500 4.500 0 1 1 1.200-8.800A5.500 5.500 0 0 1 18.500 8a3.500 3.500 0 0 1-.5 7z"/><path d="m8.500 18-1 2.500M12.500 18l-1 2.500M16.500 18l-1 2.500"/>'),
  petal: svg(
    `<circle cx="12" cy="12" r="1.500" ${SOLID}/><path d="M12 10.200c-2-1.700-2-4.800 0-6.700 2 1.900 2 5 0 6.700zM13.700 11.400c1-2.400 3.900-3.400 6.300-2-1.200 2.500-4.100 3.500-6.300 2zM13.100 13.500c2.600 0 4.500 2.400 3.900 5.100-2.700-.3-4.600-2.700-3.900-5.100zM10.900 13.500c.7 2.400-1.200 4.800-3.900 5.100-.600-2.700 1.300-5.100 3.900-5.100zM10.300 11.400c-2.200 1.500-5.100.5-6.300-2 2.400-1.400 5.300-.4 6.300 2z"/>`,
  ),
};

/** Drivetrain diagram: which axle is driven (filled wheels). */
export function driveIcon(layout: 'FWD' | 'RWD' | 'AWD' | 'stock'): string {
  const front = layout === 'FWD' || layout === 'AWD';
  const rear = layout === 'RWD' || layout === 'AWD';
  const wheel = (x: number, y: number, on: boolean) =>
    `<rect x="${x}" y="${y}" width="4" height="6" rx="1.200" ${on ? 'fill="currentColor"' : 'opacity="0.55"'}/>`;
  if (layout === 'stock') return svg(`<text x="12" y="16.500" font-size="12" text-anchor="middle" font-weight="800" ${SOLID}>A</text>`);
  return svg(`${wheel(3.5, 3, front)}${wheel(16.5, 3, front)}${wheel(3.5, 15, rear)}${wheel(16.5, 15, rear)}<path d="M7.500 6h9M7.500 18h9M12 6v12"/>`);
}
