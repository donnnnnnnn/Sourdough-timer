import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  Platform,
  Animated,
  Easing,
  StyleSheet,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { useBakeStore } from '@/store/useBakeStore';
import { suggestBulk, estimatedRise, foldLatenessAdvice, formatTemp } from '@/lib/bulkCoach';
import { scheduleFoldAlarms, cancelFoldAlarms, MAX_PLANNED_FOLDS } from '@/lib/foldAlarm';
import { syncBulkPanel, clearBulkPanel } from '@/lib/bulkStatusPanel';
import { AUTOLYSE_COPY } from '@/components/FermentationScene';
// Deliberately NOT a static import of SkiaFermentationScene: the Skia module
// runs code at import time, and a throw there would crash the whole route
// before any error boundary mounts. SafeSkiaFermentationScene lazy-loads the
// scene inside a boundary that falls back to the pure-JS FermentationScene
// (see components/SkiaErrorBoundary.tsx and docs/SKIA-HANDOFF.md).
import { SafeSkiaFermentationScene } from '@/components/SkiaErrorBoundary';
import { GlassStageProvider, GlassCard } from '@/components/GlassCard';
import { setScrollY, setContentTop } from '@/components/glassStage';
import { C, fonts, accentForFraction, lerpColor, motion, thump, successHaptic, Haptics } from '@/components/theme';
import { AppText } from '@/components/ui/AppText';
import { Chip } from '@/components/ui/Chip';
import { Corridor } from '@/components/ui/Corridor';
import { Dial } from '@/components/ui/Dial';
import { DoughButton } from '@/components/ui/DoughButton';
import { Icon } from '@/components/ui/Icon';
import { Journey } from '@/components/ui/Journey';
import { Ruler } from '@/components/ui/Ruler';
import { Sheet } from '@/components/ui/Sheet';
import { Squish } from '@/components/ui/Squish';

const AUTOLYSE_OPTIONS = [20, 30, 45, 60];

const FOLD_INTERVALS = [30, 45, 60];
const FOLD_LATE_THRESHOLD_MIN = 5;
const TARGET_STEP = 15;       // ruler snaps expected bulk in 15-min detents
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

/** Soft breathing dot shown while the dough is fermenting. */
function PulseDot({ color = C.accent }: { color?: string }) {
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
  return <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity: pulse }} />;
}

// Bubble tints used by the celebration burst and the fold-pad ripple.
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

function Bubble({ spec, once = false }: { spec: BubbleSpec; once?: boolean }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const timing = Animated.timing(t, {
      toValue: 1,
      duration: spec.duration,
      delay: spec.delay,
      easing: Easing.inOut(Easing.sin),
      useNativeDriver: true,
    });
    if (once) {
      timing.start();
      return;
    }
    const loop = Animated.loop(timing, { resetBeforeIteration: true });
    loop.start();
    return () => loop.stop();
  }, [t, spec, once]);

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

/** One-shot bubble ripple inside the fold pad — fires on each recorded fold. */
function PadBurst({ trigger }: { trigger: number }) {
  const specs = useMemo(() => {
    const s = makeBubbles(6);
    for (const b of s) {
      b.duration = 750 + Math.random() * 550;
      b.delay = Math.random() * 140;
      b.rise = 90 + Math.random() * 60;
      b.peak = Math.min(1, b.peak + 0.2);
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  if (trigger <= 0) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}>
      {specs.map((spec, i) => (
        <Bubble key={`${trigger}-${i}`} spec={spec} once />
      ))}
    </View>
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
        borderRadius: 34,
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
 * Contextual tip when the observed rise diverges more than 15 percentage
 * points from the temperature-model estimate. Describes, never grades, and
 * always ends with a next-bake action (house voice — plan §3.6).
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
        borderRadius: 12,
        padding: 12,
        gap: 4,
      }}>
      <AppText role="caption" color={fast ? C.accent : C.textMuted} style={{ fontWeight: '700' }}>
        {fast ? 'Rising faster than expected' : 'Rising slower than expected'}
      </AppText>
      <AppText role="caption" color={C.textMuted}>
        {fast
          ? 'Your dough is ahead of the model — watch it closely and shape earlier if the windowpane looks good. Next bake: try water a few degrees cooler, or reduce your levain % slightly.'
          : 'Your dough is behind the model — give it more time and check the windowpane before shaping. Next bake: try warmer water, a larger levain %, or check that your starter doubled reliably before mixing.'}
      </AppText>
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
      <AppText role="displayLg">Beautiful bulk.</AppText>
      <AppText role="body" color={C.textMuted} style={{ marginTop: 8 }}>
        {durationLabel} — on to shaping
      </AppText>
    </Animated.View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
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
    tempUnit,
    riseMarks,
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
    setTempUnit,
    addRiseMark,
  } = useBakeStore();

  const [selectedInterval, setSelectedInterval] = useState(30);
  const [foldCount, setFoldCount] = useState(defaultFoldCount);
  const [plannedTarget, setPlannedTarget] = useState(targetDurationMinutes);
  const [celebrating, setCelebrating] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [lateFoldConfirm, setLateFoldConfirm] = useState<{ lateMinutes: number } | null>(null);
  const [endConfirm, setEndConfirm] = useState(false);

  // Frosted-glass stage: the scroll content container node (glass cards measure
  // their position against it) and a tick that asks all cards to re-measure
  // once scrolling settles, so any drift self-corrects.
  // The RAW View ref is stored, NOT findNodeHandle(node): on the New
  // Architecture, measureLayout rejects numeric node handles (silently, via
  // its failure callback), which left glassStage empty — no card ever
  // registered, so no glass panel was ever drawn.
  const [contentNode, setContentNode] = useState<View | null>(null);
  const [measureTick, setMeasureTick] = useState(0);
  const onContentRef = useCallback((node: View | null) => {
    setContentNode(node);
    if (node) {
      node.measureInWindow((_x: number, y: number) => {
        setContentTop(y);
      });
    }
  }, []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setScrollY(e.nativeEvent.contentOffset.y);
  }, []);
  const remeasureGlass = useCallback(() => setMeasureTick((t) => t + 1), []);

  // Coach: suggested bulk time from kitchen temp + the user's own history.
  const suggestion = useMemo(() => suggestBulk(doughTempF, bakeLogs, tempUnit), [doughTempF, bakeLogs, tempUnit]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endNotificationId = useRef<string | null>(null);

  const isActive = bulkStartTimestamp !== null;
  const autolyseEndTs = autolyseStartTimestamp !== null ? autolyseStartTimestamp + autolyseDurationMinutes * 60000 : 0;
  const autolyseRunning = autolyseStartTimestamp !== null && now < autolyseEndTs;
  const autolyseDone = autolyseStartTimestamp !== null && now >= autolyseEndTs;
  const autolyseNotificationId = useRef<string | null>(null);

  // Entrance for the active view: scroll home, then fade/slide in — without
  // the scroll reset the active view inherits whatever offset the setup list
  // was left at and opens mid-screen.
  const scrollRef = useRef<ScrollView>(null);
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isActive) {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      // Programmatic scrolls don't always fire onScroll — keep the Skia glass
      // stage in step or its panels render at the stale offset.
      setScrollY(0);
      remeasureGlass();
      enter.setValue(0);
      Animated.timing(enter, {
        toValue: 1,
        duration: motion.enterMs,
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
      Animated.spring(foldPop, { toValue: 1, ...motion.pop, useNativeDriver: true }).start();
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

  // Keep the pull-down-shade panel (Android) in step with the bulk. The OS
  // renders the live countdowns itself, so this only needs to run when the
  // underlying state actually changes — start, fold recorded, target moved.
  useEffect(() => {
    if (!bulkStartTimestamp) {
      clearBulkPanel();
      return;
    }
    syncBulkPanel({
      completedFolds,
      plannedFolds: defaultFoldCount,
      nextFoldDueTimestamp,
      targetEndTimestamp: bulkStartTimestamp + targetDurationMinutes * 60000,
    });
  }, [bulkStartTimestamp, completedFolds, defaultFoldCount, nextFoldDueTimestamp, targetDurationMinutes]);

  // Heavier pulse to "arm" the Start Bulk button once autolyse is done.
  const armPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!autolyseDone) {
      armPulse.setValue(0);
      return;
    }
    successHaptic();
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
      setLateFoldConfirm({ lateMinutes });
      return;
    }
    recordFold();
  }

  /** keepSchedule=true: next fold stays on the original cadence. Otherwise the interval restarts from now. */
  function resolveLateFold(keepSchedule: boolean) {
    setLateFoldConfirm(null);
    recordFold({ keepSchedule });
  }

  function handleEndConfirmed() {
    if (celebrating) return;
    setEndConfirm(false);
    successHaptic();
    cancelNotifications();
    // One last bubble burst before moving on to shaping.
    setCelebrating(true);
    setTimeout(() => {
      setCelebrating(false);
      endBulk();
      router.push('/log');
    }, 2400);
  }

  /** Adjust the target mid-bulk: persist it and reschedule the end alert. */
  function adjustActiveTargetTo(minutes: number) {
    const next = Math.max(TARGET_MIN, Math.min(TARGET_MAX, minutes));
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

  // First couple of minutes: caption acknowledges the levain just went in.
  const justStarted = isActive && elapsedSecs < 120;

  // The timer digits warm from cream toward honey as bulk approaches target —
  // capped at 1 so the color stops at full honey instead of extrapolating.
  const bulkFraction = isActive ? Math.min(1, elapsedMs / (targetDurationMinutes * 60000)) : 0;
  const timerColor = lerpColor('#F2E8DC', '#E8A33D', bulkFraction);
  // Uncapped fraction for the scene/journey, so overproofing keeps visibly
  // progressing (and is correctly labeled) past the planned target.
  const sceneFraction = isActive ? elapsedMs / (targetDurationMinutes * 60000) : 0;
  const accent = accentForFraction(sceneFraction);

  // One fullscreen scene drives the whole screen: bulk while active, the
  // amylase-led autolyse look while resting, else the near-empty idle field.
  const sceneMode: 'idle' | 'autolyse' | 'bulk' = isActive
    ? 'bulk'
    : autolyseRunning
      ? 'autolyse'
      : 'idle';

  const recentLog = bakeLogs.length > 0 ? bakeLogs[0] : null;
  const lastRise = riseMarks.length > 0 ? riseMarks[riseMarks.length - 1].pct : risePercent;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Fullscreen living "microscope" backdrop, behind everything. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <SafeSkiaFermentationScene mode={sceneMode} fraction={sceneFraction} />
      </View>

      <GlassStageProvider contentNode={contentNode} measureTick={measureTick}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 0 }}
          scrollEventThrottle={16}
          onScroll={onScroll}
          onMomentumScrollEnd={remeasureGlass}
          onScrollEndDrag={remeasureGlass}>
          <View
            ref={onContentRef}
            onLayout={remeasureGlass}
            style={{ padding: 24, paddingTop: insets.top + 16, paddingBottom: 48 }}>

            {recentLog && !isActive && (
              <GlassCard radius={20} tint={0.4} blur={14} style={{ padding: 18, marginBottom: 24 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <Icon name="spark" size={22} color={C.accent} />
                  <View style={{ flex: 1 }}>
                    <AppText role="label">Your last bake</AppText>
                    <AppText role="emphasis" style={{ fontSize: 18, marginTop: 2 }}>
                      {formatMinutes(recentLog.bulkDurationMinutes)} · {recentLog.foldCount} fold
                      {recentLog.foldCount !== 1 ? 's' : ''}
                    </AppText>
                  </View>
                </View>
              </GlassCard>
            )}

            {!isActive ? (
              <View style={{ gap: 20 }}>
                {autolyseRunning ? (
                  <View style={{ alignItems: 'center', paddingVertical: 14, minHeight: 200, justifyContent: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <Icon name="flask" size={14} color={C.accent} />
                      <AppText role="label" color={C.accent}>
                        Autolyse resting
                      </AppText>
                    </View>
                    <AppText role="hero" style={{ fontSize: 60, lineHeight: 66 }}>
                      {(() => {
                        const left = formatElapsed(Math.max(0, autolyseEndTs - now));
                        return `${left.minutes}:${left.seconds}`;
                      })()}
                    </AppText>
                    <AppText role="caption" style={{ marginTop: 2 }}>
                      until the levain goes in
                    </AppText>
                    <Squish
                      onPress={handleCancelAutolyse}
                      accessibilityLabel="Cancel autolyse"
                      hitSlop={8}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 14, paddingVertical: 8, paddingHorizontal: 12 }}>
                      <Icon name="close" size={13} color={C.textDim} />
                      <AppText role="caption">cancel autolyse</AppText>
                    </Squish>
                  </View>
                ) : (
                  <View style={{ paddingVertical: 8 }}>
                    <AppText role="displayLg">{autolyseDone ? 'Levain time.' : 'Ready to bake?'}</AppText>
                    <AppText role="body" color={C.textMuted} style={{ fontSize: 16, marginTop: 6 }}>
                      {autolyseDone
                        ? 'Autolyse done — mix in your levain, then start bulk.'
                        : 'Plan tonight’s bake, then hand the clock to us.'}
                    </AppText>
                  </View>
                )}

                {autolyseRunning && (
                  <GlassCard radius={20} tint={0.44} blur={14} style={{ padding: 18 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent }} />
                      <AppText role="label" color={C.accent}>
                        Pre-ferment · {AUTOLYSE_COPY.title}
                      </AppText>
                    </View>
                    <AppText role="body" color={C.text}>
                      {AUTOLYSE_COPY.science}
                    </AppText>
                    <View style={{ height: 1, backgroundColor: C.cardBorder, marginVertical: 12 }} />
                    <AppText role="label">In the bowl</AppText>
                    <AppText role="body" color={C.textMuted} style={{ fontStyle: 'italic', marginTop: 4 }}>
                      {AUTOLYSE_COPY.sensory}
                    </AppText>
                  </GlassCard>
                )}

                {/* The bake plan: one card, every knob */}
                <GlassCard radius={24} tint={0.4} blur={14} style={{ padding: 20 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                      <Icon name="thermometer" size={14} color={C.textMuted} />
                      <AppText role="label">Kitchen temp</AppText>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <Chip label="°F" selected={tempUnit === 'F'} onPress={() => setTempUnit('F')} accessibilityLabel="Show Fahrenheit" />
                      <Chip label="°C" selected={tempUnit === 'C'} onPress={() => setTempUnit('C')} accessibilityLabel="Show Celsius" />
                    </View>
                  </View>
                  <Dial valueF={doughTempF} onChange={setDoughTemp} unit={tempUnit} />

                  {/* Coach: temperature + your history in, suggested bulk out */}
                  <View
                    style={{
                      marginTop: 12,
                      backgroundColor: C.accentSoft,
                      borderRadius: 14,
                      padding: 14,
                    }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                        <Icon name="spark" size={16} color={C.accent} />
                        <AppText role="emphasis">
                          Suggested bulk: {formatMinutes(suggestion.minutes)}
                        </AppText>
                      </View>
                      {plannedTarget !== suggestion.minutes && (
                        <Chip
                          label="Use"
                          selected
                          onPress={() => setPlannedTarget(suggestion.minutes)}
                          accessibilityLabel={`Use suggested bulk of ${formatMinutes(suggestion.minutes)}`}
                        />
                      )}
                    </View>
                    <AppText role="caption" color={C.textMuted} style={{ marginTop: 6 }}>
                      {suggestion.reason}
                    </AppText>
                  </View>

                  <View style={{ marginTop: 14 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <AppText role="label">Expected bulk</AppText>
                      <AppText role="emphasis" color={C.accent} style={{ fontVariant: ['tabular-nums'] }}>
                        {formatMinutes(plannedTarget)}
                      </AppText>
                    </View>
                    <Ruler
                      value={plannedTarget}
                      min={TARGET_MIN}
                      max={TARGET_MAX}
                      step={TARGET_STEP}
                      majorEvery={4}
                      onChange={setPlannedTarget}
                      format={formatMinutes}
                      accessibilityLabel="Expected bulk length"
                    />
                  </View>

                  <View style={{ marginTop: 14 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <AppText role="label">Planned folds</AppText>
                      <AppText role="emphasis" color={C.accent} style={{ fontVariant: ['tabular-nums'] }}>
                        {foldCount}
                      </AppText>
                    </View>
                    <Ruler
                      value={foldCount}
                      min={0}
                      max={MAX_PLANNED_FOLDS}
                      step={1}
                      majorEvery={1}
                      onChange={setFoldCount}
                      accessibilityLabel="Planned folds"
                    />
                  </View>

                  <View style={{ marginTop: 14 }}>
                    <AppText role="label" style={{ marginBottom: 8 }}>
                      Remind me every
                    </AppText>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {FOLD_INTERVALS.map((mins) => (
                        <Chip
                          key={mins}
                          label={`${mins}`}
                          sub="min"
                          grow
                          selected={selectedInterval === mins}
                          onPress={() => setSelectedInterval(mins)}
                          accessibilityLabel={`Fold reminder every ${mins} minutes`}
                        />
                      ))}
                    </View>
                  </View>

                  {!autolyseRunning && !autolyseDone && (
                    <View style={{ marginTop: 14 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <Icon name="flask" size={13} color={C.textMuted} />
                        <AppText role="label">Autolyse first (optional)</AppText>
                        <AppText role="caption" style={{ flex: 1 }} numberOfLines={1}>
                          — its own flour + water timer
                        </AppText>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {AUTOLYSE_OPTIONS.map((m) => (
                          <Chip
                            key={m}
                            label={`${m}m`}
                            grow
                            onPress={() => handleStartAutolyse(m)}
                            accessibilityLabel={`Start a ${m} minute autolyse rest`}
                          />
                        ))}
                      </View>
                    </View>
                  )}
                </GlassCard>

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
                          borderRadius: 36,
                          borderWidth: 2,
                          borderColor: C.accent,
                          opacity: armPulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.85] }),
                          transform: [{ scale: armPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }],
                        }}
                      />
                    )}
                    <DoughButton
                      label="Start Bulk"
                      onPress={handleStart}
                      variant="honey"
                      size="lg"
                      accessibilityHint="Starts the bulk fermentation timer and fold reminders"
                    />
                  </View>
                  <AppText
                    role="caption"
                    center
                    color={autolyseDone ? C.accent : C.textDim}
                    style={{ marginTop: 10, fontWeight: autolyseDone ? '700' : '400' }}>
                    {autolyseDone
                      ? 'levain in? don’t forget the salt'
                      : 'starter mixed in? we’ll ring you for every fold and the finish'}
                  </AppText>
                </View>
              </View>
            ) : (
              <Animated.View
                style={{
                  gap: 14,
                  opacity: enter,
                  transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
                }}>
                <View style={{ alignItems: 'center', minHeight: 148, justifyContent: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <PulseDot color={accent} />
                    <AppText role="label" color={accent}>
                      {justStarted ? 'Levain in' : 'Bulk fermenting'}
                    </AppText>
                  </View>
                  <AppText role="hero" color={timerColor} style={{ letterSpacing: -4 }}>
                    {elapsed.hours}:{elapsed.minutes}
                  </AppText>
                  <AppText role="stat" color={C.textDim} style={{ fontSize: 24, lineHeight: 28, marginTop: -4, fontWeight: '300' }}>
                    :{elapsed.seconds}
                  </AppText>
                </View>

                {/* The dough pad: countdown + count + record, one surface, thumb-first */}
                <DoughButton
                  label="Record a fold"
                  onPress={handleFold}
                  variant="soft"
                  accessibilityLabel="Record a fold"
                  accessibilityHint={
                    foldsComplete
                      ? `All ${defaultFoldCount} folds recorded`
                      : `${completedFolds} of ${defaultFoldCount} folds recorded, next due in ${nextFold.minutes} minutes ${nextFold.seconds} seconds`
                  }
                  style={{ overflow: 'hidden' }}>
                  <PadBurst trigger={completedFolds} />
                  <View style={{ alignItems: 'center', width: '100%' }}>
                    {foldsComplete ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Icon name="check" size={14} color={C.accent} />
                        <AppText role="label" color={C.accent}>
                          All folds in
                        </AppText>
                      </View>
                    ) : foldIsLate ? (
                      <AppText role="label" color={C.ember}>
                        Fold {completedFolds + 1} due · {lateMinutes}m ago
                      </AppText>
                    ) : (
                      <AppText role="label" color={C.accent} style={{ fontVariant: ['tabular-nums'] }}>
                        Next fold in {nextFold.minutes}:{nextFold.seconds}
                      </AppText>
                    )}
                    <Animated.Text
                      style={{
                        color: C.accent,
                        fontSize: 58,
                        fontWeight: '200',
                        lineHeight: 64,
                        marginTop: 2,
                        fontVariant: ['tabular-nums'],
                        transform: [{ scale: foldPop }],
                      }}>
                      {completedFolds}
                    </Animated.Text>
                    <View style={{ marginTop: 6 }}>
                      <FoldDots completed={completedFolds} planned={defaultFoldCount} />
                    </View>
                    {!foldsComplete && (
                      <View
                        style={{
                          width: '68%',
                          height: 4,
                          borderRadius: 2,
                          backgroundColor: 'rgba(232,163,61,0.18)',
                          marginTop: 10,
                          overflow: 'hidden',
                        }}>
                        <View
                          style={{
                            width: `${Math.min(100, intervalProgress * 100)}%`,
                            height: '100%',
                            borderRadius: 2,
                            backgroundColor: foldIsLate ? C.ember : accent,
                          }}
                        />
                      </View>
                    )}
                    <AppText role="caption" style={{ marginTop: 8 }}>
                      {foldsComplete ? 'watch the dough for shape readiness' : 'tap to record a fold'}
                    </AppText>
                  </View>
                </DoughButton>
                {foldIsLate && (
                  <AppText role="caption" center color={C.textMuted} style={{ marginTop: -6 }}>
                    running late is okay — the dough keeps working
                  </AppText>
                )}

                {/* The journey: phase, progress, milestones, landing time */}
                <GlassCard radius={24} tint={0.5} blur={16} style={{ padding: 20 }}>
                  <Journey
                    startTs={bulkStartTimestamp ?? now}
                    foldTimestamps={foldTimestamps}
                    plannedFolds={defaultFoldCount}
                    intervalMinutes={foldIntervalMinutes}
                    nextFoldDueTimestamp={nextFoldDueTimestamp}
                    targetMinutes={targetDurationMinutes}
                    onChangeTarget={adjustActiveTargetTo}
                    targetMin={TARGET_MIN}
                    targetMax={TARGET_MAX}
                    targetStep={TARGET_STEP}
                    now={now}
                    fraction={sceneFraction}
                  />
                </GlassCard>

                {/* Predicted vs observed rise */}
                <GlassCard radius={24} tint={0.44} blur={14} style={{ padding: 20 }}>
                  <Corridor
                    elapsedMinutes={elapsedMs / 60000}
                    targetMinutes={targetDurationMinutes}
                    marks={riseMarks}
                    onAddMark={addRiseMark}
                  />
                  {lastRise > 0 && (
                    <RiseAdvisory actual={lastRise} estimated={estimatedRise(elapsedMs / 60000, targetDurationMinutes)} />
                  )}
                </GlassCard>

                {/* Ending bulk is the happy milestone, not a destructive act */}
                <DoughButton
                  label="Finish & Shape"
                  icon="loaf"
                  onPress={() => setEndConfirm(true)}
                  variant="cream"
                  size="lg"
                  glow={false}
                  accessibilityHint="Ends bulk fermentation and moves to logging"
                />
              </Animated.View>
            )}
          </View>
        </ScrollView>
      </GlassStageProvider>

      {celebrating && (
        <CelebrationOverlay durationLabel={`${formatMinutes(Math.round(elapsedMs / 60000))} of bulk`} />
      )}

      <Sheet
        visible={lateFoldConfirm !== null}
        onClose={() => setLateFoldConfirm(null)}
        title={foldLatenessAdvice(lateFoldConfirm?.lateMinutes ?? 0, doughTempF, tempUnit).title}>
        <AppText role="body" color={C.textMuted} style={{ marginBottom: 12 }}>
          {foldLatenessAdvice(lateFoldConfirm?.lateMinutes ?? 0, doughTempF, tempUnit).body}
        </AppText>
        <AppText role="body" color={C.text} style={{ marginBottom: 18 }}>
          Should the next fold stay on the original {foldIntervalMinutes}-min schedule, or start counting from
          right now?
        </AppText>
        <View style={{ gap: 10 }}>
          <DoughButton
            label="Keep original schedule"
            onPress={() => resolveLateFold(true)}
            variant="soft"
            size="md"
          />
          <DoughButton
            label={`Restart ${foldIntervalMinutes} min from now`}
            onPress={() => resolveLateFold(false)}
            variant="quiet"
            size="md"
          />
        </View>
      </Sheet>

      <Sheet visible={endConfirm} onClose={() => setEndConfirm(false)} title="Ready to shape?">
        <AppText role="body" color={C.textMuted} style={{ marginBottom: 18 }}>
          This wraps bulk at {formatMinutes(Math.round(elapsedMs / 60000))} at{' '}
          {formatTemp(doughTempF, tempUnit)}. If it's a slip of the thumb, you can undo from the Shelf.
        </AppText>
        <View style={{ gap: 10 }}>
          <DoughButton label="Finish bulk" icon="loaf" onPress={handleEndConfirmed} variant="cream" size="md" />
          <DoughButton label="Keep fermenting" onPress={() => setEndConfirm(false)} variant="quiet" size="md" />
        </View>
      </Sheet>
    </View>
  );
}
