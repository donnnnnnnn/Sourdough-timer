/**
 * Journey — the one card that answers "where is my dough and when does it
 * land." Fuses the phase caption (science + sensory), whole-bulk progress
 * with fold notches, the milestone timeline, and the planned-bulk ruler that
 * re-flows the ETA. The Flighty pattern, for dough.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { AUTOLYSE_COPY, PHASE_SCRIPT, bulkPhaseIndex, type PhaseCopy } from '@/components/FermentationScene';
import { C, accentForFraction } from '@/components/theme';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { Ruler } from './Ruler';
import { Squish } from './Squish';

function formatClock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Soft breathing dot marking "you are here". */
function BreathingDot({ color }: { color: string }) {
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
        width: 11,
        height: 11,
        borderRadius: 5.5,
        backgroundColor: color,
        opacity: pulse,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: 6,
      }}
    />
  );
}

/**
 * Crossfading phase copy. Compact by default — the sensory "in the bowl"
 * line is the glanceable one — with the full science a tap away, so the
 * teaching stays without spending half a screen on every phase.
 */
function PhaseWords({ copy, expanded, onToggle }: { copy: PhaseCopy; expanded: boolean; onToggle: () => void }) {
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
    <Animated.View style={{ opacity: fade }}>
      <AppText
        role="body"
        color={C.textMuted}
        style={{ fontStyle: 'italic' }}
        numberOfLines={expanded ? undefined : 2}>
        {c.sensory}
      </AppText>
      {expanded && (
        <>
          <View style={{ height: 1, backgroundColor: C.cardBorder, marginVertical: 10 }} />
          <AppText role="label">The science</AppText>
          <AppText role="body" color={C.text} style={{ fontSize: 14.5, marginTop: 4 }}>
            {c.science}
          </AppText>
        </>
      )}
      <Squish
        onPress={onToggle}
        haptic="light"
        hitSlop={6}
        accessibilityLabel={expanded ? 'Hide the science' : 'Read the science behind this phase'}
        style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
        <AppText role="caption" color={C.straw} style={{ fontWeight: '700' }}>
          {expanded ? 'hide the science' : 'the science ›'}
        </AppText>
      </Squish>
    </Animated.View>
  );
}

type MilestoneState = 'done' | 'due' | 'future';

interface JourneyProps {
  startTs: number;
  foldTimestamps: number[];
  plannedFolds: number;
  intervalMinutes: number;
  /** Actual due time for the next undone fold — reflects any reschedule. */
  nextFoldDueTimestamp: number | null;
  targetMinutes: number;
  onChangeTarget: (minutes: number) => void;
  targetMin: number;
  targetMax: number;
  targetStep: number;
  now: number;
  /** elapsed / planned bulk, uncapped (drives the phase + accent). */
  fraction: number;
  /** True during the autolyse rest — swaps the phase copy. */
  autolyse?: boolean;
}

export function Journey({
  startTs,
  foldTimestamps,
  plannedFolds,
  intervalMinutes,
  nextFoldDueTimestamp,
  targetMinutes,
  onChangeTarget,
  targetMin,
  targetMax,
  targetStep,
  now,
  fraction,
  autolyse = false,
}: JourneyProps) {
  const phaseIdx = bulkPhaseIndex(fraction);
  const copy = autolyse ? AUTOLYSE_COPY : PHASE_SCRIPT[phaseIdx];
  const accent = accentForFraction(fraction);
  const targetEndTs = startTs + targetMinutes * 60000;
  const elapsedMinutes = (now - startTs) / 60000;
  const overdue = elapsedMinutes > targetMinutes;
  const [scienceOpen, setScienceOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(false);

  // Milestone rows: mixed-in start, each fold (actual once recorded, due
  // until then), shaping at the planned end.
  const foldRows = Math.max(plannedFolds, foldTimestamps.length);
  const rows: { label: string; time: string; state: MilestoneState }[] = [
    { label: 'Levain mixed in', time: formatClock(startTs), state: 'done' },
  ];
  for (let i = 0; i < foldRows; i++) {
    const done = i < foldTimestamps.length;
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

  // Whole-bulk progress with a notch per scheduled fold.
  const progress = Math.min(1, elapsedMinutes / targetMinutes);
  const tickCount = Math.floor(targetMinutes / intervalMinutes);
  const notches = Array.from({ length: tickCount })
    .map((_, k) => ((k + 1) * intervalMinutes) / targetMinutes)
    .filter((frac) => frac < 0.995);

  const dotColor = (s: MilestoneState) => (s === 'done' ? accent : s === 'due' ? C.ember : C.textDim);

  return (
    <View>
      {/* header: phase + landing time */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          <BreathingDot color={accent} />
          <AppText role="label" color={accent} numberOfLines={1} style={{ flexShrink: 1 }}>
            {autolyse ? `Pre-ferment · ${copy.title}` : `${phaseIdx + 1}/5 · ${copy.title}`}
          </AppText>
        </View>
        {!autolyse && (
          <Squish
            onPress={() => setEditTarget((o) => !o)}
            haptic="light"
            hitSlop={6}
            accessibilityLabel={`Bulk lands about ${formatClock(targetEndTs)}. Tap to adjust the planned length.`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              backgroundColor: editTarget ? C.accentSoft : C.parchment2,
              borderRadius: 999,
              paddingVertical: 6,
              paddingHorizontal: 11,
            }}>
            <Icon name="clock" size={12} color={editTarget ? C.accent : C.textMuted} />
            <AppText
              role="caption"
              color={editTarget ? C.accent : C.textMuted}
              style={{ fontWeight: '600', fontVariant: ['tabular-nums'] }}>
              lands ~{formatClock(targetEndTs)}
            </AppText>
          </Squish>
        )}
      </View>

      {/* whole-bulk progress with fold notches */}
      {!autolyse && (
        <View style={{ marginBottom: 10 }}>
          <View style={{ width: '100%', height: 12, borderRadius: 6, backgroundColor: C.chip, overflow: 'hidden' }}>
            <View
              style={{
                width: `${progress * 100}%`,
                height: '100%',
                borderRadius: 6,
                backgroundColor: overdue ? C.ember : accent,
              }}
            />
            {notches.map((frac, i) => (
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
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 }}>
            <AppText role="caption">{formatMinutes(Math.floor(elapsedMinutes))} elapsed</AppText>
            <AppText role="caption" color={overdue ? C.ember : C.textDim}>
              {overdue
                ? `${formatMinutes(Math.ceil(elapsedMinutes - targetMinutes))} past plan`
                : `${formatMinutes(Math.ceil(targetMinutes - elapsedMinutes))} to go`}
            </AppText>
          </View>
        </View>
      )}

      {/* planned-bulk ruler: revealed by the "lands ~" chip; re-flows the ETA */}
      {!autolyse && editTarget && (
        <View style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <AppText role="label">Planned bulk</AppText>
            <AppText role="emphasis" color={C.text} style={{ fontVariant: ['tabular-nums'] }}>
              {formatMinutes(targetMinutes)}
            </AppText>
          </View>
          <Ruler
            value={targetMinutes}
            min={targetMin}
            max={targetMax}
            step={targetStep}
            majorEvery={4}
            onChange={onChangeTarget}
            format={(v) => formatMinutes(v)}
            accessibilityLabel="Planned bulk length"
          />
        </View>
      )}

      <PhaseWords copy={copy} expanded={scienceOpen} onToggle={() => setScienceOpen((o) => !o)} />

      {/* milestone timeline */}
      {!autolyse && (
        <View style={{ marginTop: 10 }}>
          {rows.map((row, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <View style={{ alignItems: 'center', width: 20 }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    marginTop: 4,
                    backgroundColor: row.state === 'done' ? accent : 'transparent',
                    borderWidth: 1.5,
                    borderColor: dotColor(row.state),
                  }}
                />
                {i < rows.length - 1 && (
                  <View style={{ width: 1.5, flex: 1, minHeight: 8, backgroundColor: C.cardBorder, marginVertical: 2 }} />
                )}
              </View>
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingBottom: i < rows.length - 1 ? 8 : 0,
                  marginLeft: 10,
                }}>
                <AppText
                  role="body"
                  color={row.state === 'future' ? C.textMuted : C.text}
                  style={{ fontSize: 14.5, fontWeight: row.state === 'due' ? '700' : '500' }}>
                  {row.label}
                  {row.state === 'due' ? ' — due' : ''}
                </AppText>
                <AppText role="body" color={row.state === 'due' ? C.ember : C.textDim} style={{ fontVariant: ['tabular-nums'] }}>
                  {row.time}
                </AppText>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
