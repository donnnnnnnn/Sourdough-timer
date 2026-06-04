import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useBakeStore } from '@/store/useBakeStore';
import { router } from 'expo-router';

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
      className="flex-1 bg-stone-50"
      contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>

      {recentLog && !isActive && (
        <View className="bg-white border border-stone-200 rounded-2xl p-5 mb-6">
          <Text className="text-stone-400 text-xs font-semibold uppercase tracking-widest mb-1">
            Your last great loaf
          </Text>
          <Text className="text-stone-800 text-2xl font-bold">
            {formatMinutes(recentLog.bulkDurationMinutes)} · {recentLog.foldCount} fold{recentLog.foldCount !== 1 ? 's' : ''}
          </Text>
          <View className="flex-row mt-2" style={{ gap: 8 }}>
            <View className="bg-stone-100 rounded-full px-3 py-1">
              <Text className="text-stone-600 text-sm">{recentLog.crumbType}</Text>
            </View>
            <View className="bg-stone-100 rounded-full px-3 py-1">
              <Text className="text-stone-600 text-sm">{recentLog.shapeType}</Text>
            </View>
          </View>
        </View>
      )}

      {!isActive ? (
        <View style={{ gap: 24 }}>
          <View>
            <Text className="text-stone-800 text-4xl font-bold mb-1">Ready to bake?</Text>
            <Text className="text-stone-400 text-lg">Set your fold reminder interval.</Text>
          </View>

          <View>
            <Text className="text-stone-500 text-xs font-semibold uppercase tracking-widest mb-3">
              Alert me every
            </Text>
            <View className="flex-row" style={{ gap: 12 }}>
              {FOLD_INTERVALS.map((mins) => {
                const active = selectedInterval === mins;
                return (
                  <TouchableOpacity
                    key={mins}
                    onPress={() => setSelectedInterval(mins)}
                    style={{
                      flex: 1,
                      paddingVertical: 20,
                      borderRadius: 16,
                      alignItems: 'center',
                      backgroundColor: active ? '#b5521e' : '#ffffff',
                      borderWidth: 2,
                      borderColor: active ? '#b5521e' : '#e7e5e4',
                    }}>
                    <Text
                      style={{
                        fontSize: 28,
                        fontWeight: '700',
                        color: active ? '#ffffff' : '#292524',
                      }}>
                      {mins}
                    </Text>
                    <Text style={{ fontSize: 13, color: active ? '#fde8d8' : '#a8a29e' }}>
                      min
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <TouchableOpacity
            onPress={handleStart}
            style={{
              backgroundColor: '#b5521e',
              borderRadius: 24,
              paddingVertical: 32,
              alignItems: 'center',
              marginTop: 8,
            }}>
            <Text style={{ color: '#ffffff', fontSize: 32, fontWeight: '700' }}>
              Start Bulk
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ gap: 20 }}>
          <View style={{ alignItems: 'center' }}>
            <Text className="text-stone-400 text-xs font-semibold uppercase tracking-widest mb-2">
              Bulk fermenting
            </Text>
            <Text
              style={{
                color: '#1c1917',
                fontSize: 88,
                fontWeight: '800',
                lineHeight: 96,
                letterSpacing: -2,
              }}>
              {elapsed.hours}:{elapsed.minutes}
            </Text>
            <Text style={{ color: '#a8a29e', fontSize: 28, marginTop: -4 }}>
              :{elapsed.seconds}
            </Text>
          </View>

          <View
            className="bg-white border border-stone-200 rounded-2xl"
            style={{ padding: 20, alignItems: 'center' }}>
            <Text className="text-stone-400 text-xs font-semibold uppercase tracking-widest mb-1">
              Next fold in
            </Text>
            <Text style={{ color: '#292524', fontSize: 40, fontWeight: '700' }}>
              {nextFold.minutes}:{nextFold.seconds}
            </Text>
            <Text className="text-stone-400 text-sm mt-1">
              every {foldIntervalMinutes} min
            </Text>
          </View>

          <TouchableOpacity
            onPress={recordFold}
            style={{
              backgroundColor: '#ffffff',
              borderWidth: 2,
              borderColor: '#e7e5e4',
              borderRadius: 20,
              paddingVertical: 28,
              alignItems: 'center',
            }}>
            <Text className="text-stone-400 text-xs font-semibold uppercase tracking-widest mb-1">
              Folds completed
            </Text>
            <Text style={{ color: '#1c1917', fontSize: 72, fontWeight: '800', lineHeight: 80 }}>
              {completedFolds}
            </Text>
            <Text className="text-stone-400 text-sm mt-1">tap to record a fold</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleEnd}
            style={{
              backgroundColor: '#1c1917',
              borderRadius: 24,
              paddingVertical: 28,
              alignItems: 'center',
            }}>
            <Text style={{ color: '#ffffff', fontSize: 24, fontWeight: '700' }}>
              End Bulk & Shape
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}
