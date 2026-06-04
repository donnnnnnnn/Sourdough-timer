import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useBakeStore } from '@/store/useBakeStore';
import { router } from 'expo-router';
import { Sparkles } from 'lucide-react-native';

const FOLD_INTERVALS = [30, 45, 60];

const C = {
  bg: '#0c0c0f',
  card: 'rgba(255,255,255,0.05)',
  cardBorder: 'rgba(255,255,255,0.08)',
  accent: '#F59E0B',
  accentSoft: 'rgba(245,158,11,0.15)',
  accentBorder: 'rgba(245,158,11,0.3)',
  text: '#e4e4e7',
  textMuted: 'rgba(255,255,255,0.45)',
  textDim: 'rgba(255,255,255,0.25)',
};

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

export default function HomeScreen() {
  const {
    bulkStartTimestamp,
    foldIntervalMinutes,
    completedFolds,
    bakeLogs,
    startBulk,
    recordFold,
    endBulk,
  } = useBakeStore();

  const [selectedInterval, setSelectedInterval] = useState(30);
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isActive = bulkStartTimestamp !== null;

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
    scheduleNotification(selectedInterval);
    startBulk(selectedInterval);
    setNow(Date.now());
  }

  function handleEnd() {
    cancelNotifications();
    endBulk();
    router.push('/log');
  }

  const elapsedMs = isActive ? now - (bulkStartTimestamp ?? now) : 0;
  const elapsed = formatElapsed(elapsedMs);

  const elapsedSecs = Math.floor(elapsedMs / 1000);
  const intervalSecs = foldIntervalMinutes * 60;
  const elapsedInCurrentInterval = elapsedSecs % intervalSecs;
  const secondsUntilNextFold = intervalSecs - elapsedInCurrentInterval;
  const nextFold = formatElapsed(secondsUntilNextFold * 1000);

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
            <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1.5 }}>
              Your last great loaf
            </Text>
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '700', marginTop: 2 }}>
              {formatMinutes(recentLog.bulkDurationMinutes)} · {recentLog.foldCount} fold{recentLog.foldCount !== 1 ? 's' : ''}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8, paddingVertical: 3, paddingHorizontal: 10 }}>
                <Text style={{ color: C.textMuted, fontSize: 12 }}>{recentLog.crumbType}</Text>
              </View>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8, paddingVertical: 3, paddingHorizontal: 10 }}>
                <Text style={{ color: C.textMuted, fontSize: 12 }}>{recentLog.shapeType}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {!isActive ? (
        <View style={{ gap: 28 }}>
          <View>
            <Text style={{ color: C.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.5 }}>
              Ready to bake?
            </Text>
            <Text style={{ color: C.textMuted, fontSize: 16, marginTop: 4 }}>
              Set your fold reminder interval.
            </Text>
          </View>

          <View>
            <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 14 }}>
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
                    <Text
                      style={{
                        fontSize: 30,
                        fontWeight: '700',
                        color: active ? C.accent : C.text,
                      }}>
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

          <TouchableOpacity
            onPress={handleStart}
            activeOpacity={0.8}
            style={{
              backgroundColor: C.accent,
              borderRadius: 22,
              paddingVertical: 26,
              alignItems: 'center',
              marginTop: 4,
              shadowColor: C.accent,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.35,
              shadowRadius: 24,
            }}>
            <Text style={{ color: '#0c0c0f', fontSize: 26, fontWeight: '800', letterSpacing: -0.3 }}>
              Start Bulk
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ gap: 20 }}>
          <View style={{ alignItems: 'center', paddingTop: 8 }}>
            <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>
              Bulk fermenting
            </Text>
            <Text
              style={{
                color: C.text,
                fontSize: 88,
                fontWeight: '200',
                lineHeight: 96,
                letterSpacing: -4,
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
              }}>
              {elapsed.hours}:{elapsed.minutes}
            </Text>
            <Text style={{
              color: C.textDim,
              fontSize: 28,
              fontWeight: '300',
              fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
              marginTop: -4,
            }}>
              :{elapsed.seconds}
            </Text>
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
            <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 6 }}>
              Next fold in
            </Text>
            <Text style={{
              color: C.text,
              fontSize: 38,
              fontWeight: '300',
              fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            }}>
              {nextFold.minutes}:{nextFold.seconds}
            </Text>
            <Text style={{ color: C.textDim, fontSize: 13, marginTop: 4 }}>
              every {foldIntervalMinutes} min
            </Text>
          </View>

          <TouchableOpacity
            onPress={recordFold}
            activeOpacity={0.7}
            style={{
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.cardBorder,
              borderRadius: 22,
              paddingVertical: 28,
              alignItems: 'center',
            }}>
            <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 4 }}>
              Folds completed
            </Text>
            <Text style={{ color: C.accent, fontSize: 72, fontWeight: '200', lineHeight: 80, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
              {completedFolds}
            </Text>
            <Text style={{ color: C.textDim, fontSize: 13, marginTop: 4 }}>tap to record a fold</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleEnd}
            activeOpacity={0.8}
            style={{
              backgroundColor: 'rgba(239,68,68,0.12)',
              borderWidth: 1,
              borderColor: 'rgba(239,68,68,0.25)',
              borderRadius: 22,
              paddingVertical: 24,
              alignItems: 'center',
            }}>
            <Text style={{ color: '#f87171', fontSize: 20, fontWeight: '700' }}>
              End Bulk & Shape
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}
