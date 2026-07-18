/**
 * ScanOverlay — the scan ritual. While the on-device model reads a crumb
 * photo, a honey scan-line sweeps the image, organism bubbles gather, and the
 * status line narrates what the model is looking at. Ten seconds of theater
 * for the app's signature feature (plan §4.3).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, View } from 'react-native';
import { C } from '@/components/theme';
import { AppText } from './AppText';

const H = 320;

const STATUS_LINES = [
  'Reading the crumb…',
  'Counting alveoli…',
  'Checking the gluten walls…',
  'Weighing the evidence…',
];

interface ScanOverlayProps {
  uri: string;
}

function ScanBubble({ delay, left, size }: { delay: number; left: string; size: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: 2600 + delay,
        delay,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
      { resetBeforeIteration: true },
    );
    loop.start();
    return () => loop.stop();
  }, [t, delay]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        bottom: 14,
        left: left as `${number}%`,
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1,
        borderColor: 'rgba(232,163,61,0.65)',
        backgroundColor: 'rgba(232,163,61,0.14)',
        opacity: t.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 0.9, 0.7, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -(H - 60)] }) },
          { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.15] }) },
        ],
      }}
    />
  );
}

export function ScanOverlay({ uri }: ScanOverlayProps) {
  const sweep = useRef(new Animated.Value(0)).current;
  const [statusIdx, setStatusIdx] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    const status = setInterval(() => setStatusIdx((i) => (i + 1) % STATUS_LINES.length), 950);
    return () => {
      loop.stop();
      clearInterval(status);
    };
  }, [sweep]);

  const bubbles = useMemo(
    () =>
      Array.from({ length: 7 }).map((_, i) => ({
        delay: i * 260,
        left: `${8 + ((i * 37) % 82)}%`,
        size: 6 + ((i * 5) % 9),
      })),
    [],
  );

  return (
    <View
      accessibilityLabel="Analyzing the crumb photo on this device"
      style={{ borderRadius: 24, overflow: 'hidden', height: H, backgroundColor: C.parchment }}>
      <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      {/* quiet the photo so the instruments read */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(18,14,12,0.35)' }} />
      {/* scan line */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: 3,
          borderRadius: 1.5,
          backgroundColor: C.accent,
          shadowColor: C.accent,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.9,
          shadowRadius: 12,
          transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [12, H - 14] }) }],
        }}
      />
      {bubbles.map((b, i) => (
        <ScanBubble key={i} {...b} />
      ))}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, alignItems: 'center' }}>
        <View
          style={{
            backgroundColor: 'rgba(18,14,12,0.78)',
            borderRadius: 999,
            paddingVertical: 8,
            paddingHorizontal: 16,
          }}>
          <AppText role="caption" color={C.cream} style={{ fontWeight: '600' }}>
            {STATUS_LINES[statusIdx]}
          </AppText>
        </View>
      </View>
    </View>
  );
}
