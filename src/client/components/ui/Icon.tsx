// Ícones lineares (traço 1.5) desenhados para a GAZU — sem dependências externas.
const PATHS: Record<string, string> = {
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm5.3-2.2L21 21',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7.5 8.5c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5',
  heart: 'M12 20.3s-7.6-4.6-9-9.5C2 7.5 4.2 4.5 7.4 4.5c2 0 3.6 1.1 4.6 2.7 1-1.6 2.6-2.7 4.6-2.7 3.2 0 5.4 3 4.4 6.3-1.4 4.9-9 9.5-9 9.5Z',
  bag: 'M5 8h14l-1 12.5H6L5 8Zm3.5 0V6.5a3.5 3.5 0 0 1 7 0V8',
  menu: 'M3.5 7h17M3.5 12h17M3.5 17h17',
  close: 'M5.5 5.5l13 13m0-13-13 13',
  arrowRight: 'M4 12h15.5m-5.5-5.5L19.5 12 14 17.5',
  arrowLeft: 'M20 12H4.5m5.5-5.5L4.5 12l5.5 5.5',
  arrowUpRight: 'M7 17 17 7m-8.5 0H17v8.5',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  chevronLeft: 'm15 6-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  truck: 'M2.5 6.5h11v9h-11zm11 3h4l3 3v3h-7zM6.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  returns: 'M3.5 8.5 12 4l8.5 4.5v7L12 20l-8.5-4.5v-7Zm0 0L12 13l8.5-4.5M12 13v7',
  badge: 'M12 3.5l2.3 1.6 2.8-.2 1 2.6 2.3 1.6-.8 2.7.8 2.7-2.3 1.6-1 2.6-2.8-.2L12 20.5l-2.3-1.6-2.8.2-1-2.6-2.3-1.6.8-2.7-.8-2.7 2.3-1.6 1-2.6 2.8.2L12 3.5Zm-3 8.6 2 2 4-4',
  lock: 'M6 10.5h12v10H6zm2.5 0V7.5a3.5 3.5 0 0 1 7 0v3M12 14.5v2.5',
  pause: 'M9 5.5v13m6-13v13',
  play: 'M8 5.5v13l10-6.5-10-6.5Z',
  check: 'm4.5 12.5 4.5 4.5L19.5 6.5',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7m-8 0 .8 12.5h9.4L17.5 7',
  filter: 'M4 6.5h16M7 12h10m-7 5.5h4',
  zoom: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm5.3-2.2L21 21M10.5 7.5v6m-3-3h6',
  alert: 'M12 4 2.8 19.5h18.4L12 4Zm0 6v4.5m0 2.5v.5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9v.5',
  copy: 'M8.5 8.5h11v11h-11zm-4-4h11v4m-11-4v11h4',
  logout: 'M14.5 4.5h5v15h-5M10 8l-4 4 4 4m-4-4h10',
  grid: 'M4.5 4.5h6v6h-6zm9 0h6v6h-6zm-9 9h6v6h-6zm9 0h6v6h-6z',
  edit: 'M4.5 19.5h4l10-10-4-4-10 10v4Zm8-12 4 4',
  external: 'M14 4.5h5.5V10m0-5.5L11 13m-1.5-7.5h-5v14h14v-5',
  ruler: 'M3.5 15.5 15.5 3.5l5 5-12 12-5-5Zm4-4 2 2m1-5 2 2m1-5 2 2',
  instagram: 'M7.5 3.5h9a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4Zm4.5 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm5-9.2v.2',
  share: 'M12 15V3.5m0 0L7.5 8M12 3.5 16.5 8M5 12v8.5h14V12',
  whatsapp: 'M4 20l1.2-4A8.5 8.5 0 1 1 8.4 19L4 20Zm5-11.5c0 3.5 3 6.5 6.5 6.5l1.3-1.6-2-1-1 .9a5 5 0 0 1-2.6-2.6l.9-1-1-2L9 8.5',
  star: 'M12 3.8l2.5 5.1 5.6.8-4.1 4 1 5.6L12 16.6l-5 2.7 1-5.6-4.1-4 5.6-.8L12 3.8Z',
  chat: 'M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2v-10Z',
  mail: 'M3.5 6h17v12h-17zm0 0 8.5 7 8.5-7',
  bell: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5Zm4 3a2 2 0 0 0 4 0',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  tag: 'M3.5 12.5v-8h8l9 9-8 8-9-9Zm4.5-4h.1',
  sparkle: 'M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8L12 3.5Z',
  book: 'M4.5 5.5c3-1 5.5-.5 7.5 1 2-1.5 4.5-2 7.5-1v13c-3-1-5.5-.5-7.5 1-2-1.5-4.5-2-7.5-1v-13Zm7.5 1v13',
  layers: 'M12 3.5 21 8l-9 4.5L3 8l9-4.5Zm-9 8.5 9 4.5 9-4.5M3 16l9 4.5 9-4.5',
  download: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M4.5 19.5h15',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  activity: 'M3 12h4l2.5-6 5 12 2.5-6h4',
  shield: 'M12 3.5 19.5 6v6c0 4.5-3.2 7.5-7.5 8.5-4.3-1-7.5-4-7.5-8.5V6L12 3.5Z',
  wallet: 'M3.5 6.5h15v12h-15zm0 0 12-3v3m-1 6.5h3.5',
  calendar: 'M4.5 6h15v14h-15zm0 4.5h15M8.5 3.5V8m7-4.5V8',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className, filled, title }: { name: IconName; size?: number; className?: string; filled?: boolean; title?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
