/** Inline SVG icons (currentColor), so the UI ships without image files. */
const svg = (body: string, view = '0 0 24 24') =>
  `<svg viewBox="${view}" aria-hidden="true" fill="currentColor">${body}</svg>`;

export const ICONS = {
  user: svg('<circle cx="12" cy="8.2" r="4.4"/><path d="M3.6 21c.6-4.6 4-7.4 8.4-7.4s7.8 2.8 8.4 7.4z"/>'),
  cart: svg(
    '<path d="M2 3.5h3.1l2.6 11.2h10.8l2.3-8.2H7.2" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/><circle cx="9.3" cy="19" r="1.9"/><circle cx="16.9" cy="19" r="1.9"/>',
  ),
  gear: svg(
    '<path d="M10.3 2h3.4l.5 2.6c.7.2 1.3.5 1.9.9l2.4-1.2 2.4 2.4-1.2 2.4c.4.6.7 1.2.9 1.9l2.6.5v3.4l-2.6.5c-.2.7-.5 1.3-.9 1.9l1.2 2.4-2.4 2.4-2.4-1.2c-.6.4-1.2.7-1.9.9l-.5 2.6h-3.4l-.5-2.6c-.7-.2-1.3-.5-1.9-.9l-2.4 1.2-2.4-2.4 1.2-2.4c-.4-.6-.7-1.2-.9-1.9L2 13.7v-3.4l2.6-.5c.2-.7.5-1.3.9-1.9L4.3 5.5l2.4-2.4 2.4 1.2c.6-.4 1.2-.7 1.9-.9zM12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z"/>',
  ),
  cash: svg(
    '<g transform="rotate(-18 12 12)"><rect x="2" y="6" width="20" height="12" rx="1.6" fill="#3f9c35"/><rect x="3.3" y="7.3" width="17.4" height="9.4" rx="1" fill="none" stroke="#bff0a6" stroke-width="1"/><circle cx="12" cy="12" r="3.1" fill="#bff0a6"/><text x="12" y="14.3" font-size="5.6" text-anchor="middle" fill="#2e7a25" font-weight="700" font-family="Arial">$</text></g>',
  ),
  plus: svg('<path d="M10.4 3h3.2v7.4H21v3.2h-7.4V21h-3.2v-7.4H3v-3.2h7.4z"/>'),
  video: svg(
    '<rect x="1.5" y="4" width="21" height="16" rx="2.4" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M1.5 8h3M1.5 12h3M1.5 16h3M19.5 8h3M19.5 12h3M19.5 16h3" stroke="currentColor" stroke-width="1.6"/><path d="M9.5 8.5v7l6-3.5z"/>',
  ),
  left: svg('<path d="M15.6 2.5 6 12l9.6 9.5 2.4-2.4L10.8 12 18 4.9z"/>'),
  right: svg('<path d="M8.4 2.5 18 12l-9.6 9.5L6 19.1 13.2 12 6 4.9z"/>'),
  speedo: svg(
    '<path d="M12 4a10 10 0 0 0-10 10c0 2 .6 3.9 1.6 5.4l1.7-1.1A8 8 0 1 1 18.7 18.3l1.7 1.1A10 10 0 0 0 12 4z"/><path d="m12.9 15.1 4.6-6.6-6.6 4.6a1.6 1.6 0 1 0 2 2z"/><path d="M12 6.3v2M5.8 9l1.4 1.2M18.2 9l-1.4 1.2M4.2 14h2M17.8 14h2" stroke="currentColor" stroke-width="1.5"/>',
  ),
  weight: svg(
    '<path d="M12 2.5a3 3 0 0 0-2.9 3.8H6.5L3 21.5h18L17.5 6.3h-2.6A3 3 0 0 0 12 2.5zm0 1.8a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z"/><text x="12" y="17.6" font-size="6.4" text-anchor="middle" fill="#2a2c30" font-weight="700" font-family="Arial">KG</text>',
  ),
  power: svg('<path d="M13.5 1.8 4 13.6h6.1L9 22.2l10-12.4h-6.3z"/>'),
  timer: svg(
    '<path d="M9 1.5h6v2.2H9z"/><path d="M12 4.6a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2zm0 2.2a6.4 6.4 0 1 1 0 12.8 6.4 6.4 0 0 1 0-12.8z"/><path d="M11 8.4h2v5.4h-2z"/>',
  ),
  drive: svg(
    '<rect x="4" y="2.5" width="4.5" height="6.5" rx="1"/><rect x="15.5" y="2.5" width="4.5" height="6.5" rx="1"/><rect x="4" y="15" width="4.5" height="6.5" rx="1"/><rect x="15.5" y="15" width="4.5" height="6.5" rx="1"/><path d="M8.5 5.7h7M8.5 18.3h7M12 5.7v12.6" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  ),
  flag: svg(
    '<path d="M4 2h2v20H4z"/><path d="M6 3h14v10H6z" fill="#fff"/><path d="M6 3h3.5v2.5H6zM13 3h3.5v2.5H13zM9.5 5.5H13V8H9.5zM16.5 5.5H20V8h-3.5zM6 8h3.5v2.5H6zM13 8h3.5v2.5H13zM9.5 10.5H13V13H9.5zM16.5 10.5H20V13h-3.5z"/>',
  ),
  wrench: svg(
    '<path d="M20.7 6.2a5.6 5.6 0 0 1-7.3 6.9l-7 7a2.1 2.1 0 0 1-3-3l7-7a5.6 5.6 0 0 1 6.9-7.3l-3.3 3.3.6 2.9 2.9.6z"/>',
  ),
  paint: svg(
    '<path d="M3.5 13.5c0-2 1.6-3.2 3.3-3.9l2.6-1.1 2-3.4c.4-.6 1-1 1.7-1h4.2c.9 0 1.6.6 1.9 1.4l1.1 3.4c1.1.4 1.7 1.4 1.7 2.6v2.1c0 .7-.5 1.2-1.2 1.2h-1a2.7 2.7 0 0 0-5.3 0H9.4a2.7 2.7 0 0 0-5.3 0H3.5zm8-3.6h4.9l-.8-3.2h-2.4z"/><circle cx="6.8" cy="15.6" r="1.8"/><circle cx="17.2" cy="15.6" r="1.8"/><path d="M5 19.5c2-.7 4-.7 6 0s4 .7 6 0" stroke="currentColor" stroke-width="1.5" fill="none"/>',
  ),
  rim: svg(
    '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.2a7.8 7.8 0 1 1 0 15.6 7.8 7.8 0 0 1 0-15.6z"/><circle cx="12" cy="12" r="2.2"/><path d="M12 4.6v5.2M12 14.2v5.2M4.6 12h5.2M14.2 12h5.2M6.8 6.8l3.6 3.6M13.6 13.6l3.6 3.6M17.2 6.8l-3.6 3.6M10.4 13.6l-3.6 3.6" stroke="currentColor" stroke-width="1.8"/>',
  ),
  tint: svg(
    '<path d="M2.5 15.5c0-1.4.9-2.4 2.2-2.8l2.3-.7 3.3-4.4c.5-.6 1.2-1 2-1h4.4c.9 0 1.7.5 2 1.3l1.6 3.8c1.1.3 1.8 1.2 1.8 2.3v1.5H2.5z"/><path d="M9 11.8 11.4 8.6c.2-.2.5-.4.8-.4h1.4l.7 3.6z" fill="#1d1f22"/><path d="M15.3 8.2h1.2c.4 0 .7.2.9.6l1.3 3h-2.7z" fill="#1d1f22"/><path d="M3 19h18" stroke="currentColor" stroke-width="1.6"/>',
  ),
  suspension: svg(
    '<path d="M8 2h8v2.4H8zM8 19.6h8V22H8z"/><path d="M8.5 6.2l7 2.2-7 2.2 7 2.2-7 2.2 7 2.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 4.4v1.8M12 17.4v2.2" stroke="currentColor" stroke-width="2"/>',
  ),
  check: svg('<path d="m3 12.6 2.6-2.6 4.4 4.4 8.4-8.4 2.6 2.6-11 11z"/>'),
  lock: svg('<path d="M12 2a5 5 0 0 0-5 5v3H5.5A1.5 1.5 0 0 0 4 11.5v9A1.5 1.5 0 0 0 5.5 22h13a1.5 1.5 0 0 0 1.5-1.5v-9a1.5 1.5 0 0 0-1.5-1.5H17V7a5 5 0 0 0-5-5zm0 2.4A2.6 2.6 0 0 1 14.6 7v3H9.4V7A2.6 2.6 0 0 1 12 4.4zm0 9.1a1.8 1.8 0 0 1 1 3.3V19h-2v-2.2a1.8 1.8 0 0 1 1-3.3z"/>'),
  pause: svg('<path d="M6 4h4.2v16H6zM13.8 4H18v16h-4.2z"/>'),
  play: svg('<path d="M7 3.5v17l14-8.5z"/>'),
  camera: svg(
    '<path d="M8.5 4h7l1.6 2.5H20a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h2.9zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>',
  ),
  road: svg('<path d="M9 2h2l-1.3 20H5zM13 2h2l4 20h-4.7z"/><path d="M11.3 4h1.4l.2 3h-1.8zM11 10h2l.2 4h-2.4zM10.7 17h2.6l.3 4h-3.2z"/>'),
};

/** Drivetrain diagram: which axle is driven (filled wheels). */
export function driveIcon(layout: 'FWD' | 'RWD' | 'AWD' | 'stock'): string {
  const front = layout === 'FWD' || layout === 'AWD';
  const rear = layout === 'RWD' || layout === 'AWD';
  const wheel = (x: number, y: number, on: boolean) =>
    `<rect x="${x}" y="${y}" width="4.6" height="6.8" rx="1.2" ${on ? '' : 'fill="none" stroke="currentColor" stroke-width="1.5"'}/>`;
  if (layout === 'stock') return svg('<text x="12" y="16.5" font-size="11" text-anchor="middle" font-weight="700" font-family="Arial">A</text>');
  return svg(
    `${wheel(3.2, 2, front)}${wheel(16.2, 2, front)}${wheel(3.2, 15.2, rear)}${wheel(16.2, 15.2, rear)}` +
      '<path d="M7.8 5.4h8.4M7.8 18.6h8.4M12 5.4v13.2" stroke="currentColor" stroke-width="2" fill="none"/>',
  );
}
