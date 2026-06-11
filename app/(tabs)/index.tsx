import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform, Animated, Easing } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useBakeStore } from '@/store/useBakeStore';
import { router } from 'expo-router';
import { Sparkles, Hand } from 'lucide-react-native';
import { C, fonts, label } from '@/components/theme';

const FOLD_INTERVALS = [30, 45, 60];

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

type BubbleSpec = {
  left: string;        // horizontal position, e.g. '37%'
  size: number;        // diameter in px
  rise: number;        // how far it floats up
  duration: number;    // one rise cycle
  delay: number;       // initial stagger — small at first = activation burst
  drift: number;       // sideways sway in px
  peak: number;        // max opacity
};

function makeBubbles(count: number): BubbleSpec[] {
  return Array.from({ length: count }).map((_, i) => ({
    left: `${6 + Math.random() * 88}%`,
    size: 3 + Math.random() * 7,
    rise: 120 + Math.random() * 110,
    duration: 2800 + Math.random() * 2600,
    // quick stagger for the first wave (the "cultures waking up" burst),
    // then each bubble loops on its own rhythm
    delay: i * 110 + Math.random() * 250,
    drift: (Math.random() - 0.5) * 26,
    peak: 0.25 + Math.random() * 0.3,
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
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      { resetBeforeIteration: true },
    );
    loop.start();
    return () => loop.stop();
  }, [t, spec]);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -spec.rise] });
  const translateX = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, spec.drift, 0] });
  const opacity = t.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, spec.peak, spec.peak, 0] });
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.15] });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        bottom: 0,
        left: spec.left as `${number}%`,
        width: spec.size,
        height: spec.size,
        borderRadius: spec.size / 2,
        backgroundColor: C.accent,
        opacity,
        transform: [{ translateY }, { translateX }, { scale }],
      }}
    />
  );
}

/**
 * The fermentation field: micro-bubbles of CO2 rising as the yeast and
 * lactic acid bacteria go to work. Bursts to life right after "Start Bulk"
 * (tight stagger), then settles into a calm ambient drift.
 */
function FermentationField() {
  const bubbles = useMemo(() => makeBubbles(16), []);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}>
      {bubbles.map((spec, i) => (
        <Bubble key={i} spec={spec} />
      ))}
    </View>
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

export default function HomeScreen() {
  const {
    bulkStartTimestamp,
    foldIntervalMinutes,
    completedFolds,
    defaultFoldCount,
    bakeLogs,
    startBulk,
    recordFold,
    endBulk,
    setDefaultFoldCount,
  } = useBakeStore();

  const [selectedInterval, setSelectedInterval] = useState(30);
  const [foldCount, setFoldCount] = useState(defaultFoldCount);
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  async function scheduleNotification(intervalMins: number) {
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

  async function cancelNotifications() {
    if (Platform.OS === 'web') return;
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch {}
  }

  function handleStart() {
    if (foldCount !== defaultFoldCount) setDefaultFoldCount(foldCount);
    scheduleNotification(selectedInterval);
    startBulk(selectedInterval);
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
          <View>
            <Text style={{ color: C.text, fontSize: 36, fontFamily: fonts.display, letterSpacing: 0.2 }}>
              Ready to bake?
            </Text>
            <Text style={{ color: C.textMuted, fontSize: 16, marginTop: 6 }}>
              Set your fold reminder interval.
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
                  <TouchableOpacity
                    key={mins}
                    onPress={() => setSelectedInterval(mins)}
                    activeOpacity={0.7}
                    style={{
                      flex: 1,
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
                  </TouchableOpacity>
                );
              })}
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
            <TouchableOpacity
              onPress={handleStart}
              activeOpacity={0.85}
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
            </TouchableOpacity>
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
          <View style={{ alignItems: 'center', paddingTop: 8 }}>
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

          <TouchableOpacity
            onPress={recordFold}
            activeOpacity={0.7}
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
          </TouchableOpacity>

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
