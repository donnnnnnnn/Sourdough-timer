/**
 * Ruler — a horizontal instrument slider with tick detents and a haptic per
 * step. Replaces the −/+ steppers for durations and counts: one drag instead
 * of a dozen taps, and the whole range is visible.
 */
import { useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import { C, tick } from '@/components/theme';
import { AppText } from './AppText';

interface RulerProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Steps per major (taller, labeled) tick. Default 4. */
  majorEvery?: number;
  format?: (value: number) => string;
  accessibilityLabel: string;
}

const H = 58;
const PAD = 16;

export function Ruler({
  value,
  min,
  max,
  step,
  onChange,
  majorEvery = 4,
  format = String,
  accessibilityLabel,
}: RulerProps) {
  const [w, setW] = useState(0);
  const last = useRef(value);
  last.current = value;

  const steps = Math.round((max - min) / step);
  // Keep the tick forest legible on narrow widths: thin to every 2nd step
  // when there are many.
  const tickEvery = steps > 40 ? 2 : 1;

  const x = (v: number) => PAD + ((v - min) / (max - min)) * (w - PAD * 2);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => handle(evt.nativeEvent.locationX),
        onPanResponderMove: (evt) => handle(evt.nativeEvent.locationX),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [w, min, max, step],
  );

  function handle(px: number) {
    if (w <= 0) return;
    const frac = Math.max(0, Math.min(1, (px - PAD) / (w - PAD * 2)));
    const raw = min + frac * (max - min);
    const next = Math.max(min, Math.min(max, Math.round(raw / step) * step));
    if (next !== last.current) {
      last.current = next;
      tick();
      onChange(next);
    }
  }

  return (
    <View
      {...pan.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: format(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const delta = e.nativeEvent.actionName === 'increment' ? step : -step;
        onChange(Math.max(min, Math.min(max, value + delta)));
      }}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ height: H, justifyContent: 'center' }}>
      {w > 0 && (
        <>
          {/* baseline */}
          <View
            style={{
              position: 'absolute',
              left: PAD,
              right: PAD,
              top: H / 2 + 8,
              height: 2,
              borderRadius: 1,
              backgroundColor: 'rgba(255,228,196,0.14)',
            }}
          />
          {/* filled portion */}
          <View
            style={{
              position: 'absolute',
              left: PAD,
              width: Math.max(0, x(value) - PAD),
              top: H / 2 + 8,
              height: 2,
              borderRadius: 1,
              backgroundColor: C.accent,
            }}
          />
          {/* ticks */}
          {Array.from({ length: Math.floor(steps / tickEvery) + 1 }).map((_, i) => {
            const v = min + i * step * tickEvery;
            if (v > max) return null;
            const major = ((v - min) / step) % majorEvery === 0;
            return (
              <View
                key={i}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: x(v) - 0.75,
                  top: H / 2 + 8 - (major ? 12 : 7),
                  width: 1.5,
                  height: major ? 12 : 7,
                  borderRadius: 1,
                  backgroundColor: major ? 'rgba(242,232,220,0.4)' : 'rgba(242,232,220,0.18)',
                }}
              />
            );
          })}
          {/* thumb */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: x(value) - 11,
              top: H / 2 - 18,
              width: 22,
              height: 34,
              borderRadius: 11,
              backgroundColor: C.cream,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: 0.35,
              shadowRadius: 6,
              elevation: 4,
            }}>
            <View style={{ width: 3, height: 12, borderRadius: 1.5, backgroundColor: C.accent }} />
          </View>
          {/* range captions */}
          <AppText role="caption" style={{ position: 'absolute', left: PAD, bottom: -4 }}>
            {format(min)}
          </AppText>
          <AppText role="caption" style={{ position: 'absolute', right: PAD, bottom: -4 }}>
            {format(max)}
          </AppText>
        </>
      )}
    </View>
  );
}
