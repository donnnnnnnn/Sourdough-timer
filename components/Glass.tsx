import { type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { glass, type GlassVariant } from './theme';

/**
 * A frosted-glass panel for the timer screen's full-bleed animated
 * background. `variant` picks the tuned tint/blur from theme.ts — `hero`
 * intentionally renders with no blur, tint, or border, since the timer
 * digits are legible directly over the animation.
 */
export function Glass({
  variant,
  style,
  children,
}: {
  variant: GlassVariant;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const g = glass[variant];
  return (
    <View
      style={[
        {
          overflow: 'hidden',
          borderRadius: 20,
          borderWidth: g.border === 'transparent' ? 0 : 1,
          borderColor: g.border,
        },
        style,
      ]}>
      {g.intensity > 0 && (
        <BlurView
          intensity={g.intensity}
          tint="dark"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      )}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: g.tint }}
      />
      {children}
    </View>
  );
}
