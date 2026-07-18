/**
 * Squish — the press feel of the whole app: scale down (with an optional
 * dough-like skew) on press-in, spring back with overshoot on release.
 * Every tappable surface routes through this so the physics stay identical.
 */
import { useRef, type ReactNode } from 'react';
import { Animated, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { motion, thump, Haptics } from '@/components/theme';

interface SquishProps {
  onPress: () => void;
  onLongPress?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  pressScale?: number;
  /** Adds a slight skew while pressed — the "poking dough" feel for Tier-1 buttons. */
  dough?: boolean;
  haptic?: 'light' | 'medium' | 'heavy' | 'none';
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  hitSlop?: number;
}

const HAPTIC_STYLE = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
} as const;

export function Squish({
  onPress,
  onLongPress,
  children,
  style,
  pressScale = 0.96,
  dough = false,
  haptic = 'light',
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  hitSlop,
}: SquishProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const skew = useRef(new Animated.Value(0)).current;

  const pressIn = () => {
    Animated.spring(scale, { toValue: pressScale, ...motion.pressIn, useNativeDriver: true }).start();
    if (dough) {
      Animated.spring(skew, { toValue: 1, ...motion.pressIn, useNativeDriver: true }).start();
    }
  };
  const pressOut = () => {
    Animated.spring(scale, { toValue: 1, ...motion.release, useNativeDriver: true }).start();
    if (dough) {
      Animated.spring(skew, { toValue: 0, ...motion.release, useNativeDriver: true }).start();
    }
  };

  return (
    <TouchableOpacity
      onPress={() => {
        if (haptic !== 'none') thump(HAPTIC_STYLE[haptic]);
        onPress();
      }}
      onLongPress={onLongPress}
      disabled={disabled}
      activeOpacity={0.9}
      onPressIn={pressIn}
      onPressOut={pressOut}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}>
      <Animated.View
        style={[
          style,
          {
            transform: [
              { scale },
              ...(dough
                ? [{ skewX: skew.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-1.2deg'] }) }]
                : []),
            ],
            opacity: disabled ? 0.45 : 1,
          },
        ]}>
        {children}
      </Animated.View>
    </TouchableOpacity>
  );
}
