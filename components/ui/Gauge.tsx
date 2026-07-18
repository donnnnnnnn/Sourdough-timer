/**
 * Gauge — a real confidence instrument: a 270° arc that fills with a spring
 * while the number counts up. Replaces the old static "ring with a % in it".
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { C } from '@/components/theme';
import { AppText } from './AppText';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface GaugeProps {
  /** 0..1 */
  value: number;
  color?: string;
  size?: number;
  caption?: string;
}

export function Gauge({ value, color = C.accent, size = 116, caption = 'confidence' }: GaugeProps) {
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);

  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const SWEEP = 0.75; // 270°

  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setShown(Math.round(v * 100)));
    Animated.timing(anim, {
      toValue: value,
      duration: 1100,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // animates an SVG stroke prop
    }).start();
    return () => anim.removeListener(id);
  }, [anim, value]);

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityLabel={`${Math.round(value * 100)} percent ${caption}`}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '135deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,228,196,0.12)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c * SWEEP} ${c}`}
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c * SWEEP} ${c}`}
          strokeDashoffset={anim.interpolate({
            inputRange: [0, 1],
            outputRange: [c * SWEEP, 0],
          })}
        />
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <AppText role="stat" color={color} style={{ fontSize: 30, lineHeight: 34 }}>
          {shown}%
        </AppText>
        <AppText role="caption" style={{ fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase' }}>
          {caption}
        </AppText>
      </View>
    </View>
  );
}
