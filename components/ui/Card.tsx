/**
 * Card — the Tier-3 "parchment" information surface for content on the bench
 * (screens or regions without the living scene behind them). Solid warm
 * surface, soft depth, NO hairline border — GlassCard remains the surface for
 * content floating over the Skia scene.
 */
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { C, radius as r } from '@/components/theme';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padding?: number;
  radius?: number;
  /** Semantic wash behind the parchment (verdict cards etc.). */
  tone?: 'parchment' | 'accent' | 'green' | 'ember' | 'violet';
}

const TONE_BG: Record<NonNullable<CardProps['tone']>, string> = {
  parchment: C.parchment,
  accent: '#2E2114',
  green: '#20261B',
  ember: '#2E1F16',
  violet: '#281F2B',
};

export function Card({ children, style, padding = 20, radius = r.slide, tone = 'parchment' }: CardProps) {
  return (
    <View
      style={[
        {
          backgroundColor: TONE_BG[tone],
          borderRadius: radius,
          padding,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.35,
          shadowRadius: 16,
          elevation: 4,
        },
        style,
      ]}>
      {children}
    </View>
  );
}
