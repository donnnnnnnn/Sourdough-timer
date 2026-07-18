/**
 * Dial — the kitchen-temperature instrument: drag around a half-arc with a
 * haptic detent per degree. Replaces the −/+ stepper (up to 32 taps → one
 * sweep). Value is stored in °F; display converts to the user's unit.
 */
import { useMemo, useRef } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { C, tick } from '@/components/theme';
import { AppText } from './AppText';

const W = 232;
const H = 136;
const CX = W / 2;
const CY = 120;
const R = 92;
const STROKE = 11;

/** Angle in degrees (180 = min/left, 0 = max/right) → point on the arc. */
function pt(angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CX + R * Math.cos(a), y: CY - R * Math.sin(a) };
}

function arcPath(fromDeg: number, toDeg: number) {
  const s = pt(fromDeg);
  const e = pt(toDeg);
  const large = Math.abs(fromDeg - toDeg) > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
}

interface DialProps {
  /** Current value, °F. */
  valueF: number;
  min?: number;
  max?: number;
  onChange: (valueF: number) => void;
  unit: 'F' | 'C';
}

export function Dial({ valueF, min = 58, max = 90, onChange, unit }: DialProps) {
  const last = useRef(valueF);
  last.current = valueF;

  const angle = 180 - ((valueF - min) / (max - min)) * 180;
  const thumb = pt(angle);
  const display = unit === 'C' ? `${Math.round(((valueF - 32) * 5) / 9)}°` : `${valueF}°`;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => handle(evt.nativeEvent.locationX, evt.nativeEvent.locationY),
        onPanResponderMove: (evt) => handle(evt.nativeEvent.locationX, evt.nativeEvent.locationY),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max],
  );

  function handle(x: number, y: number) {
    let a = (Math.atan2(CY - y, x - CX) * 180) / Math.PI; // 0 = right, 180 = left
    a = Math.max(0, Math.min(180, a));
    const raw = min + ((180 - a) / 180) * (max - min);
    const next = Math.round(raw);
    if (next !== last.current) {
      last.current = next;
      tick();
      onChange(next);
    }
  }

  return (
    <View style={{ alignItems: 'center' }}>
      <View
        {...pan.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Kitchen temperature"
        accessibilityValue={{ text: display }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const delta = e.nativeEvent.actionName === 'increment' ? 1 : -1;
          onChange(Math.max(min, Math.min(max, valueF + delta)));
        }}
        style={{ width: W, height: H }}>
        <Svg width={W} height={H} pointerEvents="none">
          {/* track */}
          <Path d={arcPath(180, 0)} stroke="rgba(255,228,196,0.14)" strokeWidth={STROKE} strokeLinecap="round" fill="none" />
          {/* filled portion */}
          {valueF > min && (
            <Path d={arcPath(180, angle)} stroke={C.accent} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
          )}
          {/* degree detents at each quarter */}
          {[0.25, 0.5, 0.75].map((f) => {
            const p = pt(180 - f * 180);
            return <Circle key={f} cx={p.x} cy={p.y} r={1.6} fill="rgba(242,232,220,0.35)" />;
          })}
          {/* thumb */}
          <Circle cx={thumb.x} cy={thumb.y} r={13} fill={C.cream} />
          <Circle cx={thumb.x} cy={thumb.y} r={5} fill={C.accent} />
        </Svg>
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 56, alignItems: 'center' }}>
          <AppText role="stat" color={C.text} style={{ fontSize: 40, lineHeight: 44 }}>
            {display}
          </AppText>
        </View>
      </View>
    </View>
  );
}
