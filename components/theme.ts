/**
 * theme.ts — the app's whole design system ("The Warm Microscope").
 * Single source of truth for color, type, spacing, shape, motion, and
 * haptics. See docs/design-modernization-plan.md Part 3 for the rationale.
 *
 * The one hierarchy rule: HONEY IS SACRED — only living/active things glow
 * honey (the running timer, a due fold, the culture). Ordinary controls wear
 * cream and parchment.
 */
import { Platform, type TextStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

// ─── Color ──────────────────────────────────────────────────────────────────
// Three depths: the culture (pure black, organisms only), the bench (espresso
// surfaces), and the slide (glass over the scene / parchment cards on the
// bench).
export const C = {
  bg: '#171210',            // espresso — the bench
  bgDeep: '#120E0C',        // gradient partner for bench backgrounds
  parchment: '#221B17',     // solid card surface (no hairline borders)
  parchment2: '#2A211C',    // nested/pressed surface on parchment
  card: 'rgba(255,228,196,0.055)',   // legacy translucent card (glass interiors)
  cardBorder: 'rgba(255,228,196,0.10)',
  accent: '#E8A33D',        // honey — life only
  accentSoft: 'rgba(232,163,61,0.14)',
  accentBorder: 'rgba(232,163,61,0.35)',
  onAccent: '#1C1208',
  straw: '#C9B37E',         // early-ferment accent (ramp start)
  ember: '#CE7B42',         // past-target accent (ramp end)
  emberSoft: 'rgba(206,123,66,0.14)',
  cream: '#F2E8DC',
  onCream: '#1C1208',
  text: '#F2E8DC',
  textMuted: 'rgba(242,232,220,0.55)',
  textDim: 'rgba(242,232,220,0.38)',
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
  // Organism-derived accents (docs/fermentation-art-spec.md locks these hues):
  violet: '#C9A8D6',        // LAB rods
  violetSoft: 'rgba(201,168,214,0.12)',
  violetBorder: 'rgba(201,168,214,0.30)',
  teal: '#6FB8A8',          // amylase
  coral: '#E58C76',         // protease
  // Deprecated aliases (pre-redesign names) — do not use in new code.
  purple: '#C9A8D6',
  purpleSoft: 'rgba(201,168,214,0.12)',
  purpleBorder: 'rgba(201,168,214,0.30)',
  orange: '#CE7B42',
  orangeSoft: 'rgba(206,123,66,0.14)',
  orangeBorder: 'rgba(206,123,66,0.32)',
  tabBar: '#1C1614',
};

/** Mix two #RRGGBB colors; t=0 gives a, t=1 gives b. */
export function lerpColor(a: string, b: string, t: number) {
  const k = Math.max(0, Math.min(1, t));
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const mix = pa.map((v, i) => Math.round(v + (pb[i] - v) * k));
  return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
}

/**
 * The palette breathes with the bake: straw → honey across bulk, honey →
 * ember once past target. `fraction` = elapsed / planned bulk (0..1+).
 */
export function accentForFraction(fraction: number): string {
  if (fraction <= 0) return C.straw;
  if (fraction < 0.65) return lerpColor(C.straw, C.accent, fraction / 0.65);
  if (fraction <= 1) return C.accent;
  return lerpColor(C.accent, C.ember, Math.min(1, (fraction - 1) / 0.35));
}

// ─── Type ───────────────────────────────────────────────────────────────────
// Fraunces (loaded in app/_layout.tsx) for display; system sans for UI; all
// numerals tabular so digits read like instruments, not paragraphs.
export const fonts = {
  display: 'Fraunces_500Medium',
  displayLight: 'Fraunces_400Regular',
  displayBold: 'Fraunces_600SemiBold',
  /** @deprecated pre-redesign timer font — numerals now use `type.hero/stat`. */
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }) as string,
};

const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/** The 7-step scale. Roles, not sizes — see plan §3.2. */
export const typeScale = {
  hero: { fontSize: 76, lineHeight: 82, fontWeight: '200', letterSpacing: -3, color: C.text, ...tabular } satisfies TextStyle,
  stat: { fontSize: 40, lineHeight: 46, fontWeight: '200', letterSpacing: -1, color: C.text, ...tabular } satisfies TextStyle,
  displayLg: { fontSize: 34, lineHeight: 40, fontFamily: fonts.display, color: C.text, letterSpacing: 0.2 } satisfies TextStyle,
  display: { fontSize: 26, lineHeight: 32, fontFamily: fonts.display, color: C.text, letterSpacing: 0.2 } satisfies TextStyle,
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600', color: C.text } satisfies TextStyle,
  emphasis: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: C.text } satisfies TextStyle,
  body: { fontSize: 14.5, lineHeight: 21, color: C.textMuted } satisfies TextStyle,
  caption: { fontSize: 12.5, lineHeight: 17, color: C.textDim } satisfies TextStyle,
  num: tabular,
};

/** Uppercase micro-label (12pt minimum, 45%-alpha minimum for legibility). */
export const label = {
  color: 'rgba(242,232,220,0.45)',
  fontSize: 12,
  fontWeight: '700' as const,
  textTransform: 'uppercase' as const,
  letterSpacing: 1.6,
};

// ─── Space & shape ──────────────────────────────────────────────────────────
export const space = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, xxl: 32 };

export const radius = {
  chip: 999,   // capsule tools
  tool: 16,    // small tool surfaces
  slide: 24,   // information cards (glass + parchment)
  sheet: 28,   // modal sheets
};

/**
 * iOS-26 "concentricity": a nested surface's radius = parent radius − the
 * padding between them (floored so tight paddings stay visibly round).
 */
export function concentric(parentRadius: number, padding: number): number {
  return Math.max(parentRadius - padding, 8);
}

/**
 * Organic "proofing boule" corner set for Tier-1 dough buttons — deliberately
 * asymmetric so the shape reads hand-made, not stamped. Scale ~1 for a
 * full-width CTA; larger for the fold pad.
 */
export function doughRadii(scale = 1) {
  return {
    borderTopLeftRadius: 26 * scale,
    borderTopRightRadius: 34 * scale,
    borderBottomRightRadius: 28 * scale,
    borderBottomLeftRadius: 38 * scale,
  };
}

// ─── Motion ─────────────────────────────────────────────────────────────────
// Dough physics: presses squish and spring back; content rises as it arrives.
export const motion = {
  pressIn: { friction: 6, tension: 220 },
  release: { friction: 4, tension: 180 },
  pop: { friction: 4, tension: 120 },
  enterMs: 500,
  crossfadeMs: 300,
  staggerMs: 40,
};

// ─── Haptics vocabulary ─────────────────────────────────────────────────────
// Light = selection · Medium = commit · Heavy = milestone press ·
// success() = phase change / bulk end · tick() = instrument detents.
export function thump(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium) {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(style).catch(() => {});
}

/** Detent tick for dials/rulers — Android gets the true clock-tick primitive. */
export function tick() {
  if (Platform.OS === 'web') return;
  if (Platform.OS === 'android' && typeof Haptics.performAndroidHapticsAsync === 'function') {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick).catch(() => {});
    return;
  }
  Haptics.selectionAsync().catch(() => {});
}

export function successHaptic() {
  if (Platform.OS === 'web') return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export { Haptics };
