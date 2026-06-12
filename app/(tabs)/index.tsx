import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform, Animated, Easing } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useBakeStore } from '@/store/useBakeStore';
import { router } from 'expo-router';
import { Sparkles, Hand, BellRing } from 'lucide-react-native';
import { C, fonts, label } from '@/components/theme';

const FOLD_INTERVALS = [30, 45, 60];
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

// ---------------------------------------------------------------------------
// Fermentation field — CO2 bubbles rising through the dough.
// Three layers give it depth: a warm glow at the base (the active dough), a
// few large slow "deep" bubbles far away, and crisp foreground bubbles with
// a glassy rim + specular highlight that sway side to side as they rise.
// ---------------------------------------------------------------------------

// Bubble tints: mostly honey (CO2 catching warm light), some cream, and the
// occasional sage fleck for the lactic acid bacteria.
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
    // quick stagger for the first wave (the "cultures waking up" burst),
    // then each bubble loops on its own rhythm
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
  // S-curve sway: drift right, back through center, drift left, recenter.
  const translateX = t.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0, spec.drift, 0, -spec.drift, 0],
  });
  const opacity = t.interpolate({
    inputRange: [0, 0.12, 0.7, 1],
    outputRange: [0, spec.peak, spec.peak, 0],
  });
  // Bubbles grow as they rise (gas expanding, pressure dropping).
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

/** Large, faint, slow bubbles far behind the foreground — depth cue. */
function DeepBubble({ index }: { index: number }) {
  const spec = useMemo(
    () => ({
      left: `${10 + Math.random() * 80}%`,
      size: 26 + Math.random() * 22,
      rise: 150 + Math.random() * 70,
      duration: 9000 + Math.random() * 6000,
      delay: index * 1700,
    }),
    [index],
  );
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

  return (
    <Animated.View
      style={{
        position: 'absolute',
        bottom: -spec.size / 2,
        left: spec.left as `${number}%`,
        width: spec.size,
        height: spec.size,
        borderRadius: spec.size / 2,
        backgroundColor: 'rgba(232,163,61,0.07)',
        opacity: t.interpolate({ inputRange: [0, 0.2, 0.75, 1], outputRange: [0, 1, 1, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -spec.rise] }) },
          { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.3] }) },
        ],
      }}
    />
  );
}

/** Warm pulsing glow at the base — the dough itself, alive and working. */
function DoughGlow() {
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath]);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        bottom: -70,
        alignSelf: 'center',
        width: 300,
        height: 130,
        borderRadius: 150,
        backgroundColor: 'rgba(232,163,61,0.10)',
        opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
        transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) }],
      }}
    />
  );
}

function FermentationField({ ambient = false }: { ambient?: boolean }) {
  // Ambient mode (idle screen): fewer, fainter, slower bubbles — a quiet
  // promise of what happens when you hit Start.
  const bubbles = useMemo(() => {
    const specs = makeBubbles(ambient ? 8 : 18);
    if (ambient) {
      for (const s of specs) {
        s.peak *= 0.4;
        s.duration *= 1.6;
      }
    }
    return specs;
  }, [ambient]);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}>
      {!ambient && <DoughGlow />}
      {!ambient && [0, 1, 2, 3].map((i) => <DeepBubble key={`deep-${i}`} index={i} />)}
      {bubbles.map((spec, i) => (
        <Bubble key={i} spec={spec} />
      ))}
    </View>
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

export default function HomeScreen() {
  const {
    bulkStartTimestamp,
    foldIntervalMinutes,
    completedFolds,
    defaultFoldCount,
    targetDurationMinutes,
    bakeLogs,
    startBulk,
    recordFold,
    endBulk,
    setDefaultFoldCount,
    setTargetDuration,
  } = useBakeStore();

  const [selectedInterval, setSelectedInterval] = useState(30);
  const [foldCount, setFoldCount] = useState(defaultFoldCount);
  const [plannedTarget, setPlannedTarget] = useState(targetDurationMinutes);
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endNotificationId = useRef<string | null>(null);

  const isActive = bulkStartTimestamp !== null;

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

  useEffect(() => {
    if (isActive) {
      tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    } else {
      if (tickRef.current) clearInterval(tickRef.current);
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [isActive]);

  async function scheduleFoldReminders(intervalMins: number) {
    if (Platform.OS === 'web') return;
    try {
      await Notifications.requestPermissionsAsync();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Time to fold!',
          body: 'Stretch and fold your dough now.',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: intervalMins * 60,
          repeats: true,
        },
      });
    } catch {}
  }

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
          body: "You planned to end bulk now — check your dough and shape if it’s ready.",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: secondsFromNow,
          repeats: false,
        },
      });
    } catch {}
  }

  async function cancelNotifications() {
    if (Platform.OS === 'web') return;
    try {
      endNotificationId.current = null;
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch {}
  }

  function handleStart() {
    if (foldCount !== defaultFoldCount) setDefaultFoldCount(foldCount);
    scheduleFoldReminders(selectedInterval);
    scheduleEndAlert(plannedTarget * 60);
    startBulk(selectedInterval, plannedTarget);
    setNow(Date.now());
  }

  function handleEnd() {
    cancelNotifications();
    endBulk();
    router.push('/log');
  }

  function changeFoldCount(delta: number) {
    setFoldCount((n) => Math.max(0, Math.min(12, n + delta)));
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
  const elapsedInCurrentInterval = elapsedSecs % intervalSecs;
  const secondsUntilNextFold = intervalSecs - elapsedInCurrentInterval;
  const nextFold = formatElapsed(secondsUntilNextFold * 1000);
  const intervalProgress = elapsedInCurrentInterval / intervalSecs;

  // First couple of minutes: caption acknowledges the starter just went in.
  const justStarted = isActive && elapsedSecs < 120;

  const targetEndTimestamp = (bulkStartTimestamp ?? 0) + targetDurationMinutes * 60000;

  const recentLog = bakeLogs.length > 0 ? bakeLogs[0] : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
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
          <View style={{ paddingVertical: 10 }}>
            <FermentationField ambient />
            <Text style={{ color: C.text, fontSize: 36, fontFamily: fonts.display, letterSpacing: 0.2 }}>
              Ready to bake?
            </Text>
            <Text style={{ color: C.textMuted, fontSize: 16, marginTop: 6 }}>
              Set your fold reminders and expected bulk time.
            </Text>
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
                <Text style={{ color: foldCount < 12 ? C.text : C.textDim, fontSize: 28, fontWeight: '300' }}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View>
            <View>
              <StartGlow />
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
            <Text style={{ color: C.textDim, fontSize: 13, textAlign: 'center', marginTop: 10 }}>
              starter mixed in?
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
          <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 12 }}>
            <FermentationField />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <PulseDot />
              <Text style={{ ...label, color: C.accent }}>
                {justStarted ? 'Cultures waking up' : 'Bulk fermenting'}
              </Text>
            </View>
            <Text
              style={{
                color: C.text,
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
            {justStarted && (
              <Text style={{ color: C.textMuted, fontSize: 13, marginTop: 8, textAlign: 'center' }}>
                Yeast and lactic acid bacteria are starting to raise your dough.
              </Text>
            )}
          </View>

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

          <Springy
            onPress={recordFold}
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
  );
}
