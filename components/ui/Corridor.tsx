/**
 * Corridor — predicted-vs-actual rise. The expected-rise band comes from the
 * temperature-corrected model (lib/bulkCoach.estimatedRise); the dotted line
 * is what the baker actually observed. Touch the chart to log a mark at the
 * current moment (replaces the ±5% stepper).
 */
import { useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { estimatedRise } from '@/lib/bulkCoach';
import { C, tick } from '@/components/theme';
import type { RiseMark } from '@/store/useBakeStore';
import { AppText } from './AppText';

const H = 132;
const PCT_MAX = 110; // display ceiling; the model itself keeps climbing
const ZONE_LOW = 50;
const ZONE_HIGH = 75;

interface CorridorProps {
  elapsedMinutes: number;
  targetMinutes: number;
  marks: RiseMark[];
  onAddMark: (pct: number) => void;
}

export function Corridor({ elapsedMinutes, targetMinutes, marks, onAddMark }: CorridorProps) {
  const [w, setW] = useState(0);
  const [preview, setPreview] = useState<number | null>(null);
  const previewRef = useRef<number | null>(null);

  const xMax = Math.max(targetMinutes * 1.25, elapsedMinutes + 20);
  const x = (min: number) => (min / xMax) * w;
  const y = (pct: number) => H - (Math.min(pct, PCT_MAX) / PCT_MAX) * (H - 10) - 5;

  // Expected band: model estimate ±12 percentage points, sampled across time.
  const band = useMemo(() => {
    if (w <= 0) return null;
    const N = 22;
    const upper: string[] = [];
    const lower: string[] = [];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * xMax;
      const est = estimatedRise(t, targetMinutes);
      upper.push(`${i === 0 ? 'M' : 'L'} ${x(t).toFixed(1)} ${y(est + 12).toFixed(1)}`);
      lower.push(`L ${x((1 - i / N) * xMax).toFixed(1)} ${y(estimatedRise((1 - i / N) * xMax, targetMinutes) - 12).toFixed(1)}`);
    }
    const center: string[] = [];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * xMax;
      center.push(`${i === 0 ? 'M' : 'L'} ${x(t).toFixed(1)} ${y(estimatedRise(t, targetMinutes)).toFixed(1)}`);
    }
    return { area: [...upper, ...lower, 'Z'].join(' '), center: center.join(' ') };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, xMax, targetMinutes]);

  // Actual line through the origin and every mark.
  const actualPath = useMemo(() => {
    if (w <= 0) return '';
    const pts = [{ atMinutes: 0, pct: 0 }, ...marks];
    return pts.map((m, i) => `${i === 0 ? 'M' : 'L'} ${x(m.atMinutes).toFixed(1)} ${y(m.pct).toFixed(1)}`).join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, xMax, marks]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => handle(evt.nativeEvent.locationY),
        onPanResponderMove: (evt) => handle(evt.nativeEvent.locationY),
        onPanResponderRelease: () => commit(),
        onPanResponderTerminate: () => commit(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [w],
  );

  function handle(py: number) {
    const pct = Math.round(Math.max(0, Math.min(PCT_MAX, ((H - 5 - py) / (H - 10)) * PCT_MAX)) / 5) * 5;
    if (pct !== previewRef.current) {
      previewRef.current = pct;
      tick();
      setPreview(pct);
    }
  }

  function commit() {
    if (previewRef.current !== null) {
      onAddMark(previewRef.current);
      previewRef.current = null;
      setPreview(null);
    }
  }

  const lastMark = marks.length > 0 ? marks[marks.length - 1] : null;
  const currentEst = Math.round(estimatedRise(elapsedMinutes, targetMinutes));
  const shown = preview ?? lastMark?.pct ?? currentEst;
  const isManual = preview !== null || lastMark !== null;
  const inZone = shown >= ZONE_LOW && shown <= ZONE_HIGH;

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <View>
          <AppText role="label">Dough rise</AppText>
          <AppText role="caption" color={C.textDim} style={{ marginTop: 2 }}>
            {preview !== null ? 'release to log' : isManual ? 'your last mark' : 'model estimate'}
          </AppText>
        </View>
        <AppText role="stat" color={inZone ? C.green : C.text} style={{ fontSize: 32, lineHeight: 36 }}>
          {shown}%
        </AppText>
      </View>

      <View
        {...pan.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Dough rise"
        accessibilityValue={{ text: `${shown} percent` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const delta = e.nativeEvent.actionName === 'increment' ? 5 : -5;
          onAddMark(Math.max(0, Math.min(PCT_MAX, shown + delta)));
        }}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        style={{ height: H }}>
        {w > 0 && band && (
          <Svg width={w} height={H} pointerEvents="none">
            {/* shape zone */}
            <Rect x={0} y={y(ZONE_HIGH)} width={w} height={y(ZONE_LOW) - y(ZONE_HIGH)} fill="rgba(143,188,112,0.10)" />
            <Line x1={0} x2={w} y1={y(ZONE_LOW)} y2={y(ZONE_LOW)} stroke={C.greenBorder} strokeWidth={1} strokeDasharray="3 5" />
            <Line x1={0} x2={w} y1={y(ZONE_HIGH)} y2={y(ZONE_HIGH)} stroke={C.greenBorder} strokeWidth={1} strokeDasharray="3 5" />
            {/* expected corridor */}
            <Path d={band.area} fill="rgba(201,179,126,0.14)" />
            <Path d={band.center} stroke="rgba(201,179,126,0.5)" strokeWidth={1.5} fill="none" />
            {/* actual */}
            <Path d={actualPath} stroke={C.cream} strokeWidth={2} strokeDasharray="2 5" strokeLinecap="round" fill="none" />
            {marks.map((m, i) => (
              <Circle key={i} cx={x(m.atMinutes)} cy={y(m.pct)} r={3.2} fill={C.cream} />
            ))}
            {/* now */}
            <Line x1={x(elapsedMinutes)} x2={x(elapsedMinutes)} y1={6} y2={H - 4} stroke="rgba(242,232,220,0.2)" strokeWidth={1} />
            <Circle
              cx={x(elapsedMinutes)}
              cy={y(preview ?? lastMark?.pct ?? currentEst)}
              r={5.5}
              fill={preview !== null ? C.cream : C.accent}
            />
          </Svg>
        )}
      </View>
      <AppText role="caption" center style={{ marginTop: 6 }} color={inZone ? C.green : C.textDim}>
        {preview !== null
          ? 'drag to your observed rise, then let go'
          : inZone
            ? 'in the zone — start watching for shape readiness'
            : shown < ZONE_LOW
              ? `shape at ${ZONE_LOW}–${ZONE_HIGH}% — touch the chart to log what you see`
              : 'past the zone — consider shaping now'}
      </AppText>
    </View>
  );
}
