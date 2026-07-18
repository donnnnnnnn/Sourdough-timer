/**
 * FoldHud — the Crouton-style always-visible stage chip: while a bulk is
 * running, other tabs show "Fold 2 · 12:33" (or the elapsed bulk once folds
 * are done). Tapping returns to the timer.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBakeStore } from '@/store/useBakeStore';
import { C } from '@/components/theme';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { Squish } from './Squish';

function two(n: number) {
  return String(Math.max(0, n)).padStart(2, '0');
}

export function FoldHud() {
  const { bulkStartTimestamp, nextFoldDueTimestamp, completedFolds, defaultFoldCount } = useBakeStore();
  const [now, setNow] = useState(Date.now());
  const insets = useSafeAreaInsets();

  const active = bulkStartTimestamp !== null;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  let text: string;
  let due = false;
  if (nextFoldDueTimestamp !== null) {
    const secs = Math.round((nextFoldDueTimestamp - now) / 1000);
    due = secs <= 0;
    text = due
      ? `Fold ${completedFolds + 1} due`
      : `Fold ${completedFolds + 1}/${defaultFoldCount} · ${two(Math.floor(secs / 60))}:${two(secs % 60)}`;
  } else {
    const mins = Math.floor((now - (bulkStartTimestamp ?? now)) / 60000);
    text = `Bulk · ${Math.floor(mins / 60)}h ${two(mins % 60)}m`;
  }

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 10, right: 16, zIndex: 10 }}>
      <Squish
        onPress={() => router.push('/')}
        accessibilityLabel={`${text}. Return to the timer.`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          backgroundColor: due ? C.accentSoft : C.parchment2,
          borderRadius: 999,
          borderWidth: 1.5,
          borderColor: due ? C.accent : 'transparent',
          paddingVertical: 8,
          paddingHorizontal: 14,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.4,
          shadowRadius: 10,
          elevation: 6,
        }}>
        <Icon name="fold" size={14} color={due ? C.accent : C.textMuted} />
        <AppText role="caption" color={due ? C.accent : C.text} style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {text}
        </AppText>
      </Squish>
    </View>
  );
}
