import { Platform } from 'react-native';

// Warm "artisan bakery" palette shared by every screen.
// Espresso-black background, cream text, honey accent.
export const C = {
  bg: '#171210',
  card: 'rgba(255,228,196,0.055)',
  cardBorder: 'rgba(255,228,196,0.10)',
  accent: '#E8A33D',
  accentSoft: 'rgba(232,163,61,0.14)',
  accentBorder: 'rgba(232,163,61,0.35)',
  onAccent: '#1C1208',
  text: '#F2E8DC',
  textMuted: 'rgba(242,232,220,0.55)',
  textDim: 'rgba(242,232,220,0.30)',
  chip: 'rgba(255,228,196,0.08)',
  // Frosted-glass panel edges (the Skia scene draws the blurred fill beneath).
  glassBorder: 'rgba(255,235,205,0.16)',
  glassSheen: 'rgba(255,245,225,0.34)',
  green: '#8FBC70',
  greenSoft: 'rgba(143,188,112,0.12)',
  greenBorder: 'rgba(143,188,112,0.28)',
  red: '#E07A5F',
  redSoft: 'rgba(224,122,95,0.12)',
  redBorder: 'rgba(224,122,95,0.28)',
  purple: '#c084fc',
  purpleSoft: 'rgba(192,132,252,0.12)',
  purpleBorder: 'rgba(192,132,252,0.3)',
  orange: '#fb923c',
  orangeSoft: 'rgba(251,146,60,0.12)',
  orangeBorder: 'rgba(251,146,60,0.3)',
  tabBar: '#1C1614',
};

export const fonts = {
  // Big friendly headlines — warm serif gives the artisan feel without
  // shipping font assets.
  display: Platform.select({ ios: 'Georgia', default: 'serif' }) as string,
  // Tabular numbers for timers.
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }) as string,
};

// Small style fragments reused across screens.
export const label = {
  color: C.textDim,
  fontSize: 11,
  fontWeight: '700' as const,
  textTransform: 'uppercase' as const,
  letterSpacing: 2,
};
