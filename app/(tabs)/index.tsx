import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform, Animated, Easing } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import { useBakeStore } from '@/store/useBakeStore';
import { suggestBulk, estimatedRise, foldLatenessAdvice } from '@/lib/bulkCoach';
import { scheduleFoldAlarms, cancelFoldAlarms, MAX_PLANNED_FOLDS } from '@/lib/foldAlarm';
import { router } from 'expo-router';
import { Sparkles, Hand, BellRing, Thermometer, Wand2, ArrowUp, FlaskConical, X, Clock, CheckCircle2 } from 'lucide-react-native';
import { C, fonts, label } from '@/components/theme';
import {
  PHASE_SCRIPT,
  AUTOLYSE_COPY,
  bulkPhaseIndex,
  type PhaseCopy,
} from '@/components/FermentationScene';
// Deliberately NOT a static import of SkiaFermentationScene: the Skia module
// runs code at import time, and a throw there would crash the whole route
// before any error boundary mounts. SafeSkiaFermentationScene lazy-loads the
// scene inside a dedicated error boundary that shows the real error + stack
// on-device (see components/SkiaErrorBoundary.tsx and docs/SKIA-HANDOFF.md).
import { SafeSkiaFermentationScene } from '@/components/SkiaErrorBoundary';

const AUTOLYSE_OPTIONS = [20, 30, 45, 60];

const FOLD_INTERVALS = [30, 45, 60];
const FOLD_LATE_THRESHOLD_MIN = 5;
const TARGET_STEP = 30;       // adjust expected bulk time in 30-min steps
const TARGET_MIN = 60;
const TARGET_MAX = 720;

function formatElapsed(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return {
    hours: String(hours).padStart(2, '0'),
    minutes: String(minutes).padStart(2, '0'),
    seconds: String(seconds).padStart(2, '0'),
  };
}

function formatMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatClock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Soft physical feedback; silently does nothing on web. */
function thump(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium) {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(style).catch(() => {});
}

/** Mix two hex colors; t=0 gives a, t=1 gives b. */
function lerpColor(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const mix = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
}

/** Soft breathing dot shown while the dough is fermenting. */
function PulseDot() {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: C.accent,
        opacity: pulse,
      }}
    />
  );
}

// Bubble tints used by the end-of-bulk celebration burst.
const TINTS = [
  { fill: 'rgba(232,163,61,0.16)', rim: 'rgba(232,163,61,0.65)' },
  { fill: 'rgba(232,163,61,0.16)', rim: 'rgba(232,163,61,0.65)' },
  { fill: 'rgba(242,232,220,0.08)', rim: 'rgba(242,232,220,0.50)' },
  { fill: 'rgba(143,188,112,0.12)', rim: 'rgba(143,188,112,0.55)' },
];

type BubbleSpec = {
  left: string;
  size: number;
  rise: number;
  duration: number;
  delay: number;
  drift: number;
  peak: number;
  tint: { fill: string; rim: string };
};

function makeBubbles(count: number): BubbleSpec[] {
  return Array.from({ length: count }).map((_, i) => ({
    left: `${6 + Math.random() * 88}%`,
    size: 5 + Math.random() * 11,
    rise: 130 + Math.random() * 110,
    duration: 4200 + Math.random() * 3600,
    delay: i * 130 + Math.random() * 300,
    drift: 8 + Math.random() * 14,
    peak: 0.55 + Math.random() * 0.4,
    tint: TINTS[Math.floor(Math.random() * TINTS.length)],
  }));
}

function Bubble({ spec }: { spec: BubbleSpec }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: spec.duration,
        delay: spec.delay,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
      { resetBeforeIteration: true },
    );
    loop.start();
    return () => loop.stop();
  }, [t, spec]);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -spec.rise] });
  const translateX = t.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0, spec.drift, 0, -spec.drift, 0],
  });
  const opacity = t.interpolate({
    inputRange: [0, 0.12, 0.7, 1],
    outputRange: [0, spec.peak, spec.peak, 0],
  });
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1.2] });

  const hl = spec.size * 0.3; // specular highlight
  return (
    <Animated.View
      style={{
        position: 'absolute',
        bottom: 0,
        left: spec.left as `${number}%`,
        opacity,
        transform: [{ translateY }, { translateX }, { scale }],
      }}>
      <View
        style={{
          width: spec.size,
          height: spec.size,
          borderRadius: spec.size / 2,
          backgroundColor: spec.tint.fill,
          borderWidth: 1,
          borderColor: spec.tint.rim,
        }}>
        <View
          style={{
            position: 'absolute',
            top: spec.size * 0.16,
            left: spec.size * 0.2,
            width: hl,
            height: hl,
            borderRadius: hl / 2,
            backgroundColor: 'rgba(255,255,255,0.5)',
          }}
        />
      </View>
    </Animated.View>
  );
}

/**
 * Tactile press wrapper: scales down on press-in and springs back on
 * release. Makes every control feel physical.
 */
function Springy({
  onPress,
  style,
  children,
  pressScale = 0.96,
}: {
  onPress: () => void;
  style?: object;
  children: ReactNode;
  pressScale?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      onPressIn={() =>
        Animated.spring(scale, { toValue: pressScale, friction: 6, tension: 220, useNativeDriver: true }).start()
      }
      onPressOut={() =>
        Animated.spring(scale, { toValue: 1, friction: 4, tension: 180, useNativeDriver: true }).start()
      }>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </TouchableOpacity>
  );
}

/** Soft halo behind the Start button that slowly breathes, inviting the tap. */
function StartGlow() {
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: -8,
        right: -8,
        top: -8,
        bottom: -8,
        borderRadius: 30,
        backgroundColor: C.accent,
        opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.22] }),
        transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }],
      }}
    />
  );
}

/** One dot per planned fold; fills in as folds are recorded. */
function FoldDots({ completed, planned }: { completed: number; planned: number }) {
  const total = Math.max(planned, completed, 1);
  return (
    <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
      {Array.from({ length: total }).map((_, i) => {
        const done = i < completed;
        return (
          <View
            key={i}
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: done ? C.accent : 'transparent',
              borderWidth: 1.5,
              borderColor: done ? C.accent : C.textDim,
            }}
          />
        );
      })}
    </View>
  );
}

type MilestoneState = 'done' | 'due' | 'future';

/**
 * The dough's story so far: starter mixed, each fold (actual time once
 * recorded, due time until then), and shaping at the planned end.
 */
function DoughStory({
  startTs,
  foldTimestamps,
  plannedFolds,
  intervalMinutes,
  nextFoldDueTimestamp,
  targetEndTs,
  now,
}: {
  startTs: number;
  foldTimestamps: number[];
  plannedFolds: number;
  intervalMinutes: number;
  /** Actual due time for the next undone fold — reflects any reschedule, not just startTs + i*interval. */
  nextFoldDueTimestamp: number | null;
  targetEndTs: number;
  now: number;
}) {
  const foldRows = Math.max(plannedFolds, foldTimestamps.length);
  const rows: { label: string; time: string; state: MilestoneState }[] = [
    { label: 'Starter mixed in', time: formatClock(startTs), state: 'done' },
  ];
  for (let i = 0; i < foldRows; i++) {
    const done = i < foldTimestamps.length;
    // Steps beyond the immediate next fold project forward from the actual
    // next-due time (which may have been rescheduled), not the original plan.
    const stepsAhead = i - foldTimestamps.length;
    const due = (nextFoldDueTimestamp ?? startTs + intervalMinutes * 60000) + stepsAhead * intervalMinutes * 60000;
    rows.push({
      label: `Fold ${i + 1}`,
      time: formatClock(done ? foldTimestamps[i] : due),
      state: done ? 'done' : now >= due ? 'due' : 'future',
    });
  }
  rows.push({
    label: 'Shape',
    time: `~${formatClock(targetEndTs)}`,
    state: now >= targetEndTs ? 'due' : 'future',
  });

  const dotColor = (s: MilestoneState) =>
    s === 'done' ? C.accent : s === 'due' ? C.orange : C.textDim;

  return (
    <View>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ alignItems: 'center', width: 20 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                marginTop: 4,
                backgroundColor: row.state === 'done' ? C.accent : 'transparent',
                borderWidth: 1.5,
                borderColor: dotColor(row.state),
              }}
            />
            {i < rows.length - 1 && (
              <View style={{ width: 1.5, flex: 1, minHeight: 16, backgroundColor: C.cardBorder, marginVertical: 3 }} />
            )}
          </View>
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingBottom: i < rows.length - 1 ? 14 : 0,
              marginLeft: 10,
            }}>
            <Text
              style={{
                color: row.state === 'future' ? C.textMuted : C.text,
                fontSize: 15,
                fontWeight: row.state === 'due' ? '700' : '500',
              }}>
              {row.label}
              {row.state === 'due' ? ' — due' : ''}
            </Text>
            <Text style={{ color: row.state === 'due' ? C.orange : C.textDim, fontSize: 14, fontFamily: fonts.mono }}>
              {row.time}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const RISE_MAX = 150;
const RISE_SWEET_LOW = 50;
const RISE_SWEET_HIGH = 75;

/**
 * Contextual tip shown when the user's actual rise reading diverges more
 * than 15 percentage points from the temperature-model estimate.
 * Differences that big usually point to something correctable next bake.
 */
function RiseAdvisory({ actual, estimated }: { actual: number; estimated: number }) {
  const delta = actual - estimated;
  if (Math.abs(delta) < 15) return null;
  const fast = delta > 0;
  return (
    <View
      style={{
        marginTop: 14,
        backgroundColor: fast ? 'rgba(232,163,61,0.08)' : 'rgba(100,130,220,0.08)',
        borderWidth: 1,
        borderColor: fast ? C.accentBorder : 'rgba(100,130,220,0.3)',
        borderRadius: 12,
        padding: 12,
        gap: 4,
      }}>
      <Text style={{ color: fast ? C.accent : C.textMuted, fontSize: 12, fontWeight: '700' }}>
        {fast ? 'Rising faster than expected' : 'Rising slower than expected'}
      </Text>
      <Text style={{ color: C.textMuted, fontSize: 12, lineHeight: 17 }}>
        {fast
          ? 'Your dough is ahead of the model — watch it closely and shape earlier if the windowpane looks good. Next bake: try water a few degrees cooler, or reduce your levain % slightly.'
          : 'Your dough is behind the model — give it more time and check the windowpane before shaping. Next bake: try warmer water, a larger levain %, or check that your starter doubled reliably before mixing.'}
      </Text>
    </View>
  );
}

/**
 * Manual rise tracker: the user marks how much the dough has grown since
 * the start of bulk. The 50-75% band is the classic "ready to shape" zone.
 */
function RiseTracker({
  pct,
  onChange,
  estimated,
}: {
  pct: number;
  onChange: (pct: number) => void;
  estimated?: number;
}) {
  const display = pct > 0 ? pct : (estimated ?? 0);
  const isManual = pct > 0;
  const inZone = display >= RISE_SWEET_LOW && display <= RISE_SWEET_HIGH;
  return (
    <View
      style={{
        backgroundColor: C.card,
        borderWidth: 1,
        borderColor: C.cardBorder,
        borderRadius: 20,
        padding: 20,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <ArrowUp color={C.textMuted} size={13} />
          <Text style={{ ...label }}>Dough rise</Text>
        </View>
        <Text style={{ color: C.textDim, fontSize: 12 }}>shape at 50–75%</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <TouchableOpacity
          onPress={() => onChange(Math.max(0, (pct > 0 ? pct : display) - 5))}
          activeOpacity={0.7}
          style={{ paddingVertical: 8, paddingHorizontal: 24 }}>
          <Text style={{ color: C.text, fontSize: 26, fontWeight: '300' }}>−</Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'center', minWidth: 120 }}>
          <Text
            style={{
              color: inZone ? C.green : C.text,
              fontSize: 44,
              fontWeight: '200',
              fontFamily: fonts.mono,
              opacity: isManual ? 1 : 0.55,
            }}>
            {display}%
          </Text>
          {!isManual && display > 0 && (
            <Text style={{ color: C.textDim, fontSize: 11, marginTop: -4 }}>estimated</Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => onChange(Math.min(RISE_MAX, (pct > 0 ? pct : display) + 5))}
          activeOpacity={0.7}
          style={{ paddingVertical: 8, paddingHorizontal: 24 }}>
          <Text style={{ color: C.text, fontSize: 26, fontWeight: '300' }}>+</Text>
        </TouchableOpacity>
      </View>
      {/* rise scale with the sweet zone marked */}
      <View style={{ height: 10, borderRadius: 5, backgroundColor: C.chip, marginTop: 12, overflow: 'hidden' }}>
        <View
          style={{
            position: 'absolute',
            left: `${(RISE_SWEET_LOW / RISE_MAX) * 100}%`,
            width: `${((RISE_SWEET_HIGH - RISE_SWEET_LOW) / RISE_MAX) * 100}%`,
            top: 0,
            bottom: 0,
            backgroundColor: C.greenSoft,
            borderLeftWidth: 1,
            borderRightWidth: 1,
            borderColor: C.greenBorder,
          }}
        />
        <View
          style={{
            width: `${(Math.min(display, RISE_MAX) / RISE_MAX) * 100}%`,
            height: '100%',
            borderRadius: 5,
            backgroundColor: inZone ? C.green : C.accent,
            opacity: isManual ? 0.85 : 0.4,
          }}
        />
      </View>
      <Text style={{ color: inZone ? C.green : C.textDim, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
        {display === 0
          ? 'tap +/− to mark actual rise, or watch the estimate build'
          : inZone
            ? 'in the zone — start watching for shape readiness'
            : display < RISE_SWEET_LOW
              ? 'still building'
              : 'past the zone — consider shaping now'}
      </Text>
      {isManual && estimated !== undefined && estimated > 0 && (
        <RiseAdvisory actual={pct} estimated={estimated} />
      )}
    </View>
  );
}

/**
 * Full-screen send-off when bulk ends: one last burst of bubbles rushing up
 * out of the dough, then on to shaping.
 */
function CelebrationOverlay({ durationLabel }: { durationLabel: string }) {
  const bubbles = useMemo(() => {
    const specs = makeBubbles(26);
    for (const s of specs) {
      s.duration = 900 + Math.random() * 900;
      s.delay = Math.random() * 350;
      s.rise = 260 + Math.random() * 240;
      s.peak = Math.min(1, s.peak + 0.25);
    }
    return specs;
  }, []);
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 250, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [fade]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        backgroundColor: 'rgba(23,18,16,0.94)',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: fade,
        zIndex: 10,
      }}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: '30%', bottom: 0, overflow: 'hidden' }}>
        {bubbles.map((spec, i) => (
          <Bubble key={i} spec={spec} />
        ))}
      </View>
      <Text style={{ color: C.text, fontSize: 34, fontFamily: fonts.display }}>Beautiful bulk.</Text>
      <Text style={{ color: C.textMuted, fontSize: 15, marginTop: 8 }}>{durationLabel} — on to shaping</Text>
    </Animated.View>
  );
}

/**
 * Shown when a fold is recorded more than FOLD_LATE_THRESHOLD_MIN late: asks
 * whether the next fold should stay on the original fixed cadence (so a late
 * tap doesn't compound into every later fold also running late) or restart
 * the interval from right now.
 */
function LateFoldConfirmOverlay({
  lateMinutes,
  intervalMinutes,
  onKeepSchedule,
  onRestartFromNow,
  onDismiss,
}: {
  lateMinutes: number;
  intervalMinutes: number;
  onKeepSchedule: () => void;
  onRestartFromNow: () => void;
  onDismiss: () => void;
}) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [fade]);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        backgroundColor: 'rgba(23,18,16,0.88)',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: fade,
        zIndex: 10,
        padding: 28,
      }}>
      <View style={{ backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 22, padding: 24, width: '100%', maxWidth: 360 }}>
        <Text style={{ color: C.text, fontSize: 20, fontWeight: '700', marginBottom: 8 }}>
          {lateMinutes} min late on this fold
        </Text>
        <Text style={{ color: C.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 20 }}>
          Should the next fold stay on the original {intervalMinutes}-min schedule, or start counting from right now?
        </Text>
        <TouchableOpacity
          onPress={onKeepSchedule}
          activeOpacity={0.8}
          style={{ backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder, borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ color: C.accent, fontSize: 15, fontWeight: '700' }}>Keep original schedule</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onRestartFromNow}
          activeOpacity={0.8}
          style={{ backgroundColor: C.chip, borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>Restart {intervalMinutes} min from now</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDismiss} activeOpacity={0.7} style={{ alignItems: 'center', paddingVertical: 6 }}>
          <Text style={{ color: C.textDim, fontSize: 13 }}>cancel</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

/**
 * Whole-bulk progress bar: fill = elapsed / expected total, with a notch at
 * every scheduled fold time. Turns orange once the target is passed.
 */
function BulkProgressBar({
  elapsedMinutes,
  targetMinutes,
  foldIntervalMinutes,
}: {
  elapsedMinutes: number;
  targetMinutes: number;
  foldIntervalMinutes: number;
}) {
  const progress = Math.min(1, elapsedMinutes / targetMinutes);
  const overdue = elapsedMinutes > targetMinutes;
  const tickCount = Math.floor(targetMinutes / foldIntervalMinutes);
  const ticks = Array.from({ length: tickCount })
    .map((_, k) => ((k + 1) * foldIntervalMinutes) / targetMinutes)
    .filter((frac) => frac < 0.995);

  return (
    <View>
      <View style={{ width: '100%', height: 12, borderRadius: 6, backgroundColor: C.chip, overflow: 'hidden' }}>
        <View
          style={{
            width: `${progress * 100}%`,
            height: '100%',
            borderRadius: 6,
            backgroundColor: overdue ? C.orange : C.accent,
          }}
        />
        {/* fold-time notches */}
        {ticks.map((frac, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: `${frac * 100}%`,
              top: 2,
              bottom: 2,
              width: 2,
              borderRadius: 1,
              backgroundColor: C.bg,
              opacity: 0.85,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
        <Text style={{ color: C.textDim, fontSize: 12 }}>
          {formatMinutes(Math.floor(elapsedMinutes))} elapsed
        </Text>
        <Text style={{ color: overdue ? C.orange : C.textDim, fontSize: 12 }}>
          {overdue
            ? `${formatMinutes(Math.ceil(elapsedMinutes - targetMinutes))} past target`
            : `${formatMinutes(Math.ceil(targetMinutes - elapsedMinutes))} to go`}
        </Text>
      </View>
    </View>
  );
}

/**
 * Two-line caption beneath the scene: a science line (the mechanism) and a
 * sensory line (what you'd feel in the bowl). Crossfades when the copy changes
 * so the words update gently while the animation keeps morphing underneath.
 */
function PhaseCaption({ copy, phaseLabel }: { copy: PhaseCopy; phaseLabel?: string }) {
  const fade = useRef(new Animated.Value(1)).current;
  const shown = useRef(copy);
  const [, force] = useState(0);
  useEffect(() => {
    if (shown.current.title === copy.title) return;
    Animated.timing(fade, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
      shown.current = copy;
      force((n) => n + 1);
      Animated.timing(fade, { toValue: 1, duration: 360, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    });
  }, [copy, fade]);
  const c = shown.current;
  return (
    <Animated.View
      style={{
        opacity: fade,
        backgroundColor: C.card,
        borderWidth: 1,
        borderColor: C.cardBorder,
        borderRadius: 20,
        padding: 18,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent }} />
        <Text style={{ ...label, color: C.accent }}>
          {phaseLabel ? `${phaseLabel} · ${c.title}` : c.title}
        </Text>
      </View>
      <Text style={{ color: C.text, fontSize: 14.5, lineHeight: 21 }}>{c.science}</Text>
      <View style={{ height: 1, backgroundColor: C.cardBorder, marginVertical: 12 }} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Text style={{ color: C.textDim, fontSize: 12, marginTop: 1 }}>IN THE BOWL</Text>
      </View>
      <Text style={{ color: C.textMuted, fontSize: 14, lineHeight: 20, marginTop: 4, fontStyle: 'italic' }}>
        {c.sensory}
      </Text>
    </Animated.View>
  );
}

export default function HomeScreen() {
  const {
    bulkStartTimestamp,
    autolyseStartTimestamp,
    autolyseDurationMinutes,
    foldIntervalMinutes,
    completedFolds,
    foldTimestamps,
    nextFoldDueTimestamp,
    defaultFoldCount,
    targetDurationMinutes,
    doughTempF,
    risePercent,
    bakeLogs,
    startAutolyse,
    cancelAutolyse,
    startBulk,
    recordFold,
    endBulk,
    setDefaultFoldCount,
    setTargetDuration,
    setDoughTemp,
    setRisePercent,
  } = useBakeStore();

  const [selectedInterval, setSelectedInterval] = useState(30);
  const [foldCount, setFoldCount] = useState(defaultFoldCount);
  const [plannedTarget, setPlannedTarget] = useState(targetDurationMinutes);
  const [celebrating, setCelebrating] = useState(false);
  const [showAutolysePicker, setShowAutolysePicker] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [lateFoldConfirm, setLateFoldConfirm] = useState<{ lateMinutes: number } | null>(null);

  // Coach: suggested bulk time from kitchen temp + the user's own history.
  const suggestion = useMemo(() => suggestBulk(doughTempF, bakeLogs), [doughTempF, bakeLogs]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endNotificationId = useRef<string | null>(null);

  const isActive = bulkStartTimestamp !== null;
  const autolyseEndTs = autolyseStartTimestamp !== null ? autolyseStartTimestamp + autolyseDurationMinutes * 60000 : 0;
  const autolyseRunning = autolyseStartTimestamp !== null && now < autolyseEndTs;
  const autolyseDone = autolyseStartTimestamp !== null && now >= autolyseEndTs;
  const autolyseNotificationId = useRef<string | null>(null);

  // Entrance for the active view: fades/slides in when bulk starts.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isActive) {
      enter.setValue(0);
      Animated.timing(enter, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [isActive, enter]);

  // Satisfying pop on the fold counter each time a fold is recorded.
  const foldPop = useRef(new Animated.Value(1)).current;
  const prevFolds = useRef(completedFolds);
  useEffect(() => {
    if (completedFolds > prevFolds.current) {
      foldPop.setValue(1.25);
      Animated.spring(foldPop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start();
    }
    prevFolds.current = completedFolds;
  }, [completedFolds, foldPop]);

  // Keep the fold reminders in sync with what's actually been recorded. Runs
  // whenever a fold is recorded, rescheduled (late-fold), or the bulk starts/
  // ends — so a fold you've already logged never fires (or keeps ringing) a
  // reminder, and the alarm always lands on the true due time.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let superseded = false;
    (async () => {
      await cancelFoldAlarms();
      if (superseded) return;
      if (isActive && nextFoldDueTimestamp != null) {
        await scheduleFoldAlarms(
          nextFoldDueTimestamp,
          completedFolds,
          defaultFoldCount,
          foldIntervalMinutes,
        );
      }
      // Both helpers trap their own errors, but a rejection escaping this IIFE
      // would be an unhandled promise rejection — swallow it so a notification
      // hiccup can never surface as an app error. Missing a reminder is the
      // acceptable worst case; crashing is not.
    })().catch(() => {});
    return () => {
      superseded = true;
    };
  }, [isActive, nextFoldDueTimestamp, completedFolds, defaultFoldCount, foldIntervalMinutes]);

  // Tick every second while a bulk OR an autolyse rest is in progress.
  const ticking = isActive || autolyseStartTimestamp !== null;
  useEffect(() => {
    if (ticking) {
      tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    } else {
      if (tickRef.current) clearInterval(tickRef.current);
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [ticking]);

  // Heavier pulse to "arm" the Start Bulk button once autolyse is done.
  const armPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!autolyseDone) {
      armPulse.setValue(0);
      return;
    }
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(armPulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(armPulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [autolyseDone, armPulse]);

  /** One-shot alert when the expected bulk time arrives. */
  async function scheduleEndAlert(secondsFromNow: number) {
    if (Platform.OS === 'web') return;
    try {
      if (endNotificationId.current) {
        await Notifications.cancelScheduledNotificationAsync(endNotificationId.current);
        endNotificationId.current = null;
      }
      if (secondsFromNow <= 0) return;
      endNotificationId.current = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Bulk ferment is up',
          body: "Check your dough and shape if it's ready.",
          sound: true,
          ...(Platform.OS === 'ios' && { interruptionLevel: 'timeSensitive' as const }),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: secondsFromNow,
          repeats: false,
          ...(Platform.OS === 'android' && { channelId: 'bake-alerts' }),
        },
      });
    } catch {}
  }

  /** Alert when the autolyse rest is up — time to add the levain. */
  async function scheduleAutolyseAlert(secondsFromNow: number) {
    if (Platform.OS === 'web') return;
    try {
      await Notifications.requestPermissionsAsync();
      autolyseNotificationId.current = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Autolyse done',
          body: 'Add your levain and salt, then start bulk.',
          sound: true,
          ...(Platform.OS === 'ios' && { interruptionLevel: 'timeSensitive' as const }),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: secondsFromNow,
          repeats: false,
          ...(Platform.OS === 'android' && { channelId: 'bake-alerts' }),
        },
      });
    } catch {}
  }

  async function cancelNotifications() {
    if (Platform.OS === 'web') return;
    try {
      endNotificationId.current = null;
      autolyseNotificationId.current = null;
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch {}
  }

  function handleStartAutolyse(minutes: number) {
    thump(Haptics.ImpactFeedbackStyle.Medium);
    setShowAutolysePicker(false);
    scheduleAutolyseAlert(minutes * 60);
    startAutolyse(minutes);
    setNow(Date.now());
  }

  function handleCancelAutolyse() {
    thump(Haptics.ImpactFeedbackStyle.Light);
    cancelNotifications();
    cancelAutolyse();
  }

  function handleStart() {
    thump(Haptics.ImpactFeedbackStyle.Heavy);
    if (Platform.OS !== 'web' && autolyseNotificationId.current) {
      Notifications.cancelScheduledNotificationAsync(autolyseNotificationId.current).catch(() => {});
      autolyseNotificationId.current = null;
    }
    if (foldCount !== defaultFoldCount) setDefaultFoldCount(foldCount);
    // Fold reminders are scheduled reactively by the sync effect once startBulk
    // sets nextFoldDueTimestamp — no need to schedule them here.
    scheduleEndAlert(plannedTarget * 60);
    startBulk(selectedInterval, plannedTarget);
    setNow(Date.now());
  }

  function handleFold() {
    const lateMinutes = nextFoldDueTimestamp ? Math.floor((Date.now() - nextFoldDueTimestamp) / 60000) : 0;
    if (lateMinutes >= FOLD_LATE_THRESHOLD_MIN) {
      thump(Haptics.ImpactFeedbackStyle.Light);
      setLateFoldConfirm({ lateMinutes });
      return;
    }
    thump(Haptics.ImpactFeedbackStyle.Medium);
    recordFold();
  }

  /** keepSchedule=true: next fold stays on the original cadence. Otherwise the interval restarts from now. */
  function resolveLateFold(keepSchedule: boolean) {
    thump(Haptics.ImpactFeedbackStyle.Medium);
    setLateFoldConfirm(null);
    recordFold({ keepSchedule });
  }

  function handleEnd() {
    if (celebrating) return;
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    cancelNotifications();
    // One last bubble burst before moving on to shaping.
    setCelebrating(true);
    setTimeout(() => {
      setCelebrating(false);
      endBulk();
      router.push('/log');
    }, 2400);
  }

  function changeFoldCount(delta: number) {
    setFoldCount((n) => Math.max(0, Math.min(MAX_PLANNED_FOLDS, n + delta)));
  }

  function changePlannedTarget(delta: number) {
    setPlannedTarget((m) => Math.max(TARGET_MIN, Math.min(TARGET_MAX, m + delta)));
  }

  /** Adjust the target mid-bulk: persist it and reschedule the end alert. */
  function adjustActiveTarget(delta: number) {
    const next = Math.max(TARGET_MIN, Math.min(TARGET_MAX, targetDurationMinutes + delta));
    if (next === targetDurationMinutes) return;
    setTargetDuration(next);
    const elapsedSecs = Math.floor((Date.now() - (bulkStartTimestamp ?? Date.now())) / 1000);
    scheduleEndAlert(next * 60 - elapsedSecs);
  }

  const elapsedMs = isActive ? now - (bulkStartTimestamp ?? now) : 0;
  const elapsed = formatElapsed(elapsedMs);

  const elapsedSecs = Math.floor(elapsedMs / 1000);
  const intervalSecs = foldIntervalMinutes * 60;
  const foldsComplete = nextFoldDueTimestamp === null && defaultFoldCount > 0 && completedFolds >= defaultFoldCount;
  const secondsUntilNextFold = nextFoldDueTimestamp ? Math.round((nextFoldDueTimestamp - now) / 1000) : 0;
  const nextFold = formatElapsed(Math.max(0, secondsUntilNextFold) * 1000);
  const intervalProgress = nextFoldDueTimestamp
    ? 1 - Math.max(0, Math.min(1, secondsUntilNextFold / intervalSecs))
    : 0;
  const lateMinutes = nextFoldDueTimestamp && secondsUntilNextFold < 0 ? Math.floor(-secondsUntilNextFold / 60) : 0;
  const foldIsLate = lateMinutes >= FOLD_LATE_THRESHOLD_MIN;

  // First couple of minutes: caption acknowledges the starter just went in.
  const justStarted = isActive && elapsedSecs < 120;

  const targetEndTimestamp = (bulkStartTimestamp ?? 0) + targetDurationMinutes * 60000;

  // The timer digits warm from cream toward honey as bulk approaches target —
  // capped at 1 so the color stops at full honey instead of extrapolating.
  const bulkFraction = isActive ? Math.min(1, elapsedMs / (targetDurationMinutes * 60000)) : 0;
  const timerColor = lerpColor('#F2E8DC', '#E8A33D', bulkFraction);
  // Uncapped fraction for the scene/phase caption, so overproofing keeps
  // visibly progressing (and is correctly labeled) past the planned target
  // instead of freezing at whatever the dough looked like right at fraction 1.
  const sceneFraction = isActive ? elapsedMs / (targetDurationMinutes * 60000) : 0;

  const recentLog = bakeLogs.length > 0 ? bakeLogs[0] : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>

      {recentLog && !isActive && (
        <View
          style={{
            backgroundColor: C.accentSoft,
            borderWidth: 1,
            borderColor: C.accentBorder,
            borderRadius: 20,
            padding: 18,
            marginBottom: 24,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
          }}>
          <Sparkles color={C.accent} size={22} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...label, letterSpacing: 1.5, color: C.textMuted }}>
              Your last bake
            </Text>
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '700', marginTop: 2 }}>
              {formatMinutes(recentLog.bulkDurationMinutes)} · {recentLog.foldCount} fold{recentLog.foldCount !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>
      )}

      {!isActive ? (
        <View style={{ gap: 28 }}>
          {autolyseRunning ? (
            <View style={{ position: 'relative', alignItems: 'center', paddingVertical: 14, minHeight: 220, justifyContent: 'center' }}>
              <SafeSkiaFermentationScene mode="autolyse" />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <FlaskConical color={C.accent} size={14} />
                <Text style={{ ...label, color: C.accent }}>Autolyse resting</Text>
              </View>
              <Text style={{ color: C.text, fontSize: 56, fontWeight: '200', fontFamily: fonts.mono, letterSpacing: -2 }}>
                {(() => {
                  const left = formatElapsed(Math.max(0, autolyseEndTs - now));
                  return `${left.minutes}:${left.seconds}`;
                })()}
              </Text>
              <Text style={{ color: C.textDim, fontSize: 13, marginTop: 2 }}>
                until the levain goes in
              </Text>
              <TouchableOpacity
                onPress={handleCancelAutolyse}
                activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 14, paddingVertical: 6, paddingHorizontal: 12 }}>
                <X color={C.textDim} size={13} />
                <Text style={{ color: C.textDim, fontSize: 13 }}>cancel autolyse</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ paddingVertical: 10, minHeight: 200, position: 'relative' }}>
              <SafeSkiaFermentationScene mode="idle" />
              <Text style={{ color: C.text, fontSize: 36, fontFamily: fonts.display, letterSpacing: 0.2 }}>
                {autolyseDone ? 'Levain time.' : 'Ready to bake?'}
              </Text>
              <Text style={{ color: C.textMuted, fontSize: 16, marginTop: 6 }}>
                {autolyseDone
                  ? 'Autolyse done — mix in your levain, then start bulk.'
                  : 'Set your fold reminders and expected bulk time.'}
              </Text>

              {!autolyseDone &&
                (showAutolysePicker ? (
                  <View
                    style={{
                      marginTop: 16,
                      backgroundColor: C.card,
                      borderWidth: 1,
                      borderColor: C.cardBorder,
                      borderRadius: 16,
                      padding: 14,
                    }}>
                    <Text style={{ ...label, marginBottom: 10 }}>Autolyse for</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {AUTOLYSE_OPTIONS.map((m) => (
                        <View key={m} style={{ flex: 1 }}>
                          <Springy
                            onPress={() => handleStartAutolyse(m)}
                            pressScale={0.93}
                            style={{
                              paddingVertical: 14,
                              borderRadius: 12,
                              alignItems: 'center',
                              backgroundColor: m === autolyseDurationMinutes ? C.accentSoft : C.chip,
                              borderWidth: 1,
                              borderColor: m === autolyseDurationMinutes ? C.accent : C.cardBorder,
                            }}>
                            <Text style={{ fontSize: 20, fontWeight: '700', color: C.text }}>{m}</Text>
                            <Text style={{ fontSize: 11, color: C.textDim }}>min</Text>
                          </Springy>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => {
                      thump(Haptics.ImpactFeedbackStyle.Light);
                      setShowAutolysePicker(true);
                    }}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: 16,
                      alignSelf: 'flex-start',
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: C.cardBorder,
                      backgroundColor: C.card,
                    }}>
                    <FlaskConical color={C.textMuted} size={14} />
                    <Text style={{ color: C.textMuted, fontSize: 13, fontWeight: '600' }}>
                      Autolyse first
                    </Text>
                  </TouchableOpacity>
                ))}
            </View>
          )}

          {autolyseRunning && <PhaseCaption copy={AUTOLYSE_COPY} phaseLabel="Pre-ferment" />}

          {/* Coach: kitchen temp in, suggested bulk time out */}
          <View
            style={{
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.cardBorder,
              borderRadius: 20,
              padding: 20,
            }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 }}>
              <Thermometer color={C.textMuted} size={13} />
              <Text style={{ ...label }}>Kitchen temp</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <TouchableOpacity
                onPress={() => setDoughTemp(Math.max(58, doughTempF - 1))}
                activeOpacity={0.7}
                style={{ paddingVertical: 8, paddingHorizontal: 24 }}>
                <Text style={{ color: C.text, fontSize: 26, fontWeight: '300' }}>−</Text>
              </TouchableOpacity>
              <Text style={{ color: C.text, fontSize: 40, fontWeight: '200', fontFamily: fonts.mono, minWidth: 110, textAlign: 'center' }}>
                {doughTempF}°F
              </Text>
              <TouchableOpacity
                onPress={() => setDoughTemp(Math.min(90, doughTempF + 1))}
                activeOpacity={0.7}
                style={{ paddingVertical: 8, paddingHorizontal: 24 }}>
                <Text style={{ color: C.text, fontSize: 26, fontWeight: '300' }}>+</Text>
              </TouchableOpacity>
            </View>
            <View
              style={{
                marginTop: 14,
                backgroundColor: C.accentSoft,
                borderWidth: 1,
                borderColor: C.accentBorder,
                borderRadius: 14,
                padding: 14,
              }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <Wand2 color={C.accent} size={16} />
                  <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>
                    Suggested bulk: {formatMinutes(suggestion.minutes)}
                  </Text>
                </View>
                {plannedTarget !== suggestion.minutes && (
                  <TouchableOpacity
                    onPress={() => {
                      thump(Haptics.ImpactFeedbackStyle.Light);
                      setPlannedTarget(suggestion.minutes);
                    }}
                    activeOpacity={0.7}
                    style={{
                      backgroundColor: C.accent,
                      borderRadius: 10,
                      paddingVertical: 7,
                      paddingHorizontal: 14,
                    }}>
                    <Text style={{ color: C.onAccent, fontSize: 13, fontWeight: '800' }}>Use</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={{ color: C.textMuted, fontSize: 12.5, marginTop: 6, lineHeight: 17 }}>
                {suggestion.reason}
              </Text>
            </View>
          </View>

          <View>
            <Text style={{ ...label, marginBottom: 14 }}>
              Alert me every
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {FOLD_INTERVALS.map((mins) => {
                const active = selectedInterval === mins;
                return (
                  <View key={mins} style={{ flex: 1 }}>
                    <Springy
                      onPress={() => setSelectedInterval(mins)}
                      pressScale={0.93}
                      style={{
                        paddingVertical: 22,
                        borderRadius: 18,
                        alignItems: 'center',
                        backgroundColor: active ? C.accentSoft : C.card,
                        borderWidth: 1.5,
                        borderColor: active ? C.accent : C.cardBorder,
                      }}>
                      <Text style={{ fontSize: 30, fontWeight: '700', color: active ? C.accent : C.text }}>
                        {mins}
                      </Text>
                      <Text style={{ fontSize: 12, color: active ? C.accent : C.textDim, marginTop: 2 }}>
                        min
                      </Text>
                    </Springy>
                  </View>
                );
              })}
            </View>
          </View>

          <View>
            <Text style={{ ...label, marginBottom: 14 }}>
              Expected bulk time
            </Text>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.cardBorder,
              borderRadius: 18,
              padding: 8,
            }}>
              <TouchableOpacity
                onPress={() => changePlannedTarget(-TARGET_STEP)}
                activeOpacity={0.7}
                style={{ paddingVertical: 12, paddingHorizontal: 28 }}>
                <Text style={{ color: plannedTarget > TARGET_MIN ? C.text : C.textDim, fontSize: 28, fontWeight: '300' }}>−</Text>
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: C.accent, fontSize: 36, fontWeight: '200', fontFamily: fonts.mono }}>
                  {formatMinutes(plannedTarget)}
                </Text>
                <Text style={{ color: C.textDim, fontSize: 12, marginTop: 2 }}>
                  we'll alert you when it's time to end bulk
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => changePlannedTarget(TARGET_STEP)}
                activeOpacity={0.7}
                style={{ paddingVertical: 12, paddingHorizontal: 28 }}>
                <Text style={{ color: plannedTarget < TARGET_MAX ? C.text : C.textDim, fontSize: 28, fontWeight: '300' }}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View>
            <Text style={{ ...label, marginBottom: 14 }}>
              Planned folds
            </Text>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.cardBorder,
              borderRadius: 18,
              padding: 8,
            }}>
              <TouchableOpacity
                onPress={() => changeFoldCount(-1)}
                activeOpacity={0.7}
                style={{ paddingVertical: 12, paddingHorizontal: 28 }}>
                <Text style={{ color: foldCount > 0 ? C.text : C.textDim, fontSize: 28, fontWeight: '300' }}>−</Text>
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: C.accent, fontSize: 40, fontWeight: '200', fontFamily: fonts.mono }}>
                  {foldCount}
                </Text>
                <Text style={{ color: C.textDim, fontSize: 12, marginTop: -2 }}>
                  fold{foldCount !== 1 ? 's' : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => changeFoldCount(1)}
                activeOpacity={0.7}
                style={{ paddingVertical: 12, paddingHorizontal: 28 }}>
                <Text style={{ color: foldCount < MAX_PLANNED_FOLDS ? C.text : C.textDim, fontSize: 28, fontWeight: '300' }}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View>
            <View>
              <StartGlow />
              {/* Once autolyse is done, an extra honey ring pulses to "arm" the button. */}
              {autolyseDone && (
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: -10,
                    right: -10,
                    top: -10,
                    bottom: -10,
                    borderRadius: 30,
                    borderWidth: 2,
                    borderColor: C.accent,
                    opacity: armPulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.85] }),
                    transform: [{ scale: armPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }],
                  }}
                />
              )}
              <Springy
                onPress={handleStart}
                pressScale={0.97}
                style={{
                  backgroundColor: C.accent,
                  borderRadius: 22,
                  paddingVertical: 26,
                  alignItems: 'center',
                  shadowColor: C.accent,
                  shadowOffset: { width: 0, height: 8 },
                  shadowOpacity: 0.35,
                  shadowRadius: 24,
                  elevation: 8,
                }}>
                <Text style={{ color: C.onAccent, fontSize: 26, fontWeight: '800', letterSpacing: -0.3 }}>
                  Start Bulk
                </Text>
              </Springy>
            </View>
            <Text
              style={{
                color: autolyseDone ? C.accent : C.textDim,
                fontSize: 13,
                textAlign: 'center',
                marginTop: 10,
                fontWeight: autolyseDone ? '700' : '400',
              }}>
              {autolyseDone ? 'levain in? don’t forget the salt' : 'starter mixed in?'}
            </Text>
          </View>
        </View>
      ) : (
        <Animated.View
          style={{
            gap: 18,
            opacity: enter,
            transform: [{
              translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
            }],
          }}>
          <View style={{ position: 'relative', alignItems: 'center', paddingTop: 8, paddingBottom: 12, minHeight: 280, justifyContent: 'center' }}>
            <SafeSkiaFermentationScene mode="bulk" fraction={sceneFraction} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <PulseDot />
              <Text style={{ ...label, color: C.accent }}>
                {justStarted ? 'Levain in' : 'Bulk fermenting'}
              </Text>
            </View>
            <Text
              style={{
                color: timerColor,
                fontSize: 88,
                fontWeight: '200',
                lineHeight: 96,
                letterSpacing: -4,
                fontFamily: fonts.mono,
              }}>
              {elapsed.hours}:{elapsed.minutes}
            </Text>
            <Text style={{
              color: C.textDim,
              fontSize: 28,
              fontWeight: '300',
              fontFamily: fonts.mono,
              marginTop: -4,
            }}>
              :{elapsed.seconds}
            </Text>
          </View>

          {/* What's happening in the dough right now — science + sensory */}
          <PhaseCaption
            copy={PHASE_SCRIPT[bulkPhaseIndex(sceneFraction)]}
            phaseLabel={`Phase ${bulkPhaseIndex(sceneFraction) + 1}/5`}
          />

          {/* Whole-bulk progress toward the planned end time */}
          <View
            style={{
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.cardBorder,
              borderRadius: 20,
              padding: 20,
            }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <Text style={{ ...label }}>Bulk progress</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <BellRing color={C.textMuted} size={13} />
                <Text style={{ color: C.textMuted, fontSize: 13 }}>
                  ends ~{formatClock(targetEndTimestamp)}
                </Text>
              </View>
            </View>
            <BulkProgressBar
              elapsedMinutes={elapsedMs / 60000}
              targetMinutes={targetDurationMinutes}
              foldIntervalMinutes={foldIntervalMinutes}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16, gap: 4 }}>
              <TouchableOpacity
                onPress={() => adjustActiveTarget(-TARGET_STEP)}
                activeOpacity={0.7}
                style={{ paddingVertical: 6, paddingHorizontal: 22 }}>
                <Text style={{ color: C.text, fontSize: 22, fontWeight: '300' }}>−</Text>
              </TouchableOpacity>
              <View style={{ alignItems: 'center', minWidth: 110 }}>
                <Text style={{ color: C.text, fontSize: 20, fontWeight: '600', fontFamily: fonts.mono }}>
                  {formatMinutes(targetDurationMinutes)}
                </Text>
                <Text style={{ color: C.textDim, fontSize: 11 }}>planned bulk</Text>
              </View>
              <TouchableOpacity
                onPress={() => adjustActiveTarget(TARGET_STEP)}
                activeOpacity={0.7}
                style={{ paddingVertical: 6, paddingHorizontal: 22 }}>
                <Text style={{ color: C.text, fontSize: 22, fontWeight: '300' }}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {foldsComplete ? (
            <View
              style={{
                backgroundColor: C.card,
                borderWidth: 1,
                borderColor: C.cardBorder,
                borderRadius: 20,
                paddingVertical: 14,
                paddingHorizontal: 20,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
              }}>
              <CheckCircle2 color={C.accent} size={18} />
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '600' }}>
                All {defaultFoldCount} folds done — watch the dough for shape readiness
              </Text>
            </View>
          ) : foldIsLate ? (
            <View
              style={{
                backgroundColor: C.card,
                borderWidth: 1,
                borderColor: C.cardBorder,
                borderRadius: 20,
                padding: 20,
              }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Clock color={C.orange} size={16} />
                <Text style={{ ...label, color: C.orange }}>{foldLatenessAdvice(lateMinutes, doughTempF).title}</Text>
              </View>
              <Text style={{ color: C.textMuted, fontSize: 14, lineHeight: 20 }}>
                {foldLatenessAdvice(lateMinutes, doughTempF).body}
              </Text>
            </View>
          ) : (
            <View
              style={{
                backgroundColor: C.card,
                borderWidth: 1,
                borderColor: C.cardBorder,
                borderRadius: 20,
                padding: 20,
                alignItems: 'center',
              }}>
              <Text style={{ ...label, marginBottom: 6 }}>
                Next fold in
              </Text>
              <Text style={{
                color: C.text,
                fontSize: 38,
                fontWeight: '300',
                fontFamily: fonts.mono,
              }}>
                {nextFold.minutes}:{nextFold.seconds}
              </Text>
              {/* progress through the current fold interval */}
              <View style={{
                width: '100%',
                height: 6,
                borderRadius: 3,
                backgroundColor: C.chip,
                marginTop: 14,
                overflow: 'hidden',
              }}>
                <View style={{
                  width: `${Math.min(100, intervalProgress * 100)}%`,
                  height: '100%',
                  borderRadius: 3,
                  backgroundColor: C.accent,
                }} />
              </View>
              <Text style={{ color: C.textDim, fontSize: 13, marginTop: 10 }}>
                every {foldIntervalMinutes} min
              </Text>
            </View>
          )}

          {/* The dough's story so far */}
          <View
            style={{
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.cardBorder,
              borderRadius: 20,
              padding: 20,
            }}>
            <Text style={{ ...label, marginBottom: 16 }}>Dough story</Text>
            <DoughStory
              startTs={bulkStartTimestamp ?? now}
              foldTimestamps={foldTimestamps}
              plannedFolds={defaultFoldCount}
              intervalMinutes={foldIntervalMinutes}
              nextFoldDueTimestamp={nextFoldDueTimestamp}
              targetEndTs={targetEndTimestamp}
              now={now}
            />
          </View>

          <RiseTracker
            pct={risePercent}
            onChange={setRisePercent}
            estimated={estimatedRise(elapsedMs / 60000, targetDurationMinutes)}
          />

          <Springy
            onPress={handleFold}
            pressScale={0.97}
            style={{
              backgroundColor: C.accentSoft,
              borderWidth: 1.5,
              borderColor: C.accentBorder,
              borderRadius: 22,
              paddingVertical: 26,
              alignItems: 'center',
            }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Hand color={C.accent} size={14} />
              <Text style={{ ...label, color: C.accent }}>
                Folds completed
              </Text>
            </View>
            <Animated.Text
              style={{
                color: C.accent,
                fontSize: 68,
                fontWeight: '200',
                lineHeight: 76,
                fontFamily: fonts.mono,
                transform: [{ scale: foldPop }],
              }}>
              {completedFolds}
            </Animated.Text>
            <View style={{ marginTop: 10, marginBottom: 6 }}>
              <FoldDots completed={completedFolds} planned={defaultFoldCount} />
            </View>
            <Text style={{ color: C.textDim, fontSize: 13 }}>tap to record a fold</Text>
          </Springy>

          <TouchableOpacity
            onPress={handleEnd}
            activeOpacity={0.8}
            style={{
              backgroundColor: C.redSoft,
              borderWidth: 1,
              borderColor: C.redBorder,
              borderRadius: 22,
              paddingVertical: 24,
              alignItems: 'center',
            }}>
            <Text style={{ color: C.red, fontSize: 20, fontWeight: '700' }}>
              End Bulk & Shape
            </Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </ScrollView>

    {celebrating && (
      <CelebrationOverlay durationLabel={`${formatMinutes(Math.round(elapsedMs / 60000))} of bulk`} />
    )}

    {lateFoldConfirm && (
      <LateFoldConfirmOverlay
        lateMinutes={lateFoldConfirm.lateMinutes}
        intervalMinutes={foldIntervalMinutes}
        onKeepSchedule={() => resolveLateFold(true)}
        onRestartFromNow={() => resolveLateFold(false)}
        onDismiss={() => setLateFoldConfirm(null)}
      />
    )}
    </View>
  );
}
