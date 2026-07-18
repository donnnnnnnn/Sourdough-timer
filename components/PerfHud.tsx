/**
 * PerfHud — dev-only frame-pacing overlay + live A/B switches.
 *
 * Shown/hidden by long-pressing the faint "· perf ·" label at the bottom of
 * the timer screen. Two jobs:
 *
 * 1. EVIDENCE. The scene's animation loop feeds perfFlags.noteFrame(); this
 *    overlay shows the rolled-up numbers (fps, worst tick, late/hitch counts,
 *    per-frame JS work) plus Hermes GC deltas when the runtime exposes them.
 *    Reading them tells us WHICH thread is missing frames:
 *      • numbers clean but the eye sees jank  → GPU-bound (render thread)
 *      • worst-tick spikes with low work ms   → something else on the JS
 *        thread (GC pauses, timers), check the gc counter
 *      • work ms itself high                  → scene recording is the cost
 *    A screenshot of this panel is a profiling report the owner can send.
 *
 * 2. A/B SWITCHES. Each non-pixel-identical optimization ships OFF-able —
 *    tapping a chip flips the flag live (no rebuild), so "does it look
 *    different / does it feel smoother" takes seconds to answer.
 *
 * Plain React Native views only — no Skia imports, safe on every platform.
 * While hidden it renders nothing and polls nothing.
 */
import { useEffect, useReducer, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  getDirectFallbackReason,
  getPerfFlags,
  perfSnap,
  setPerfFlags,
  subscribePerfFlags,
  type PerfFlags,
} from './perfFlags';

// Hermes exposes cumulative GC stats on some builds; read defensively.
function readGcCount(): number | null {
  try {
    const hi = (globalThis as unknown as { HermesInternal?: { getInstrumentedStats?: () => Record<string, unknown> } })
      .HermesInternal;
    const s = hi?.getInstrumentedStats?.();
    if (!s) return null;
    const n = (s.js_numGcs ?? s.js_gcNumCollections) as number | undefined;
    return typeof n === 'number' ? n : null;
  } catch {
    return null;
  }
}

function Chip({
  label,
  value,
  onPress,
  accent = false,
}: {
  label: string;
  value: string;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={{
        backgroundColor: accent ? 'rgba(232,163,61,0.28)' : 'rgba(255,255,255,0.10)',
        borderColor: accent ? 'rgba(232,163,61,0.8)' : 'rgba(255,255,255,0.25)',
        borderWidth: 1,
        borderRadius: 7,
        paddingHorizontal: 8,
        paddingVertical: 4,
      }}>
      <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'monospace' }}>
        {label}:{value}
      </Text>
    </Pressable>
  );
}

const SIM_STEPS: (number | null)[] = [null, 0.85, 0.97];

export function PerfHud() {
  const [, bump] = useReducer((c: number) => c + 1, 0);
  const gcBase = useRef<{ count: number; at: number } | null>(null);
  const gcRate = useRef<string>('gc n/a');

  // Re-render on flag toggles (rare) …
  useEffect(() => subscribePerfFlags(bump), []);
  const flags = getPerfFlags();

  // … and poll the 1Hz stats snapshot while visible.
  useEffect(() => {
    if (!flags.hud) return;
    const id = setInterval(() => {
      const n = readGcCount();
      if (n !== null) {
        const prev = gcBase.current;
        if (prev && n >= prev.count) {
          const perSec = ((n - prev.count) * 1000) / Math.max(1, Date.now() - prev.at);
          gcRate.current = `gc +${perSec.toFixed(1)}/s`;
        }
        gcBase.current = { count: n, at: Date.now() };
      }
      bump();
    }, 1000);
    return () => clearInterval(id);
  }, [flags.hud]);

  if (!flags.hud) return null;

  const s = perfSnap;
  const fallback = getDirectFallbackReason();
  const cycle = <K extends keyof PerfFlags>(key: K, values: PerfFlags[K][]) => {
    const cur = values.indexOf(flags[key]);
    setPerfFlags({ [key]: values[(cur + 1) % values.length] } as Partial<PerfFlags>);
  };

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: 8, left: 8, right: 8 }}>
      <View
        style={{
          backgroundColor: 'rgba(0,0,0,0.78)',
          borderColor: 'rgba(255,255,255,0.28)',
          borderWidth: 1,
          borderRadius: 10,
          padding: 8,
          gap: 6,
          alignSelf: 'flex-start',
          maxWidth: 340,
        }}>
        <Text style={{ color: '#9fe89f', fontSize: 12, fontFamily: 'monospace' }}>
          {`fps ${s.fps}  worst ${s.worstMs}ms  late ${s.late}/s  hitch ${s.hitch}/s`}
        </Text>
        <Text style={{ color: '#cfd8ff', fontSize: 12, fontFamily: 'monospace' }}>
          {`js work avg ${s.workAvgMs}ms max ${s.workMaxMs}ms  ${gcRate.current}`}
        </Text>
        <Text style={{ color: '#8a93a6', fontSize: 11, fontFamily: 'monospace' }}>
          {`totals: late ${s.totalLate}  hitch ${s.totalHitch}`}
        </Text>
        {fallback && (
          <Text style={{ color: '#ff9f9f', fontSize: 11, fontFamily: 'monospace' }}>
            direct renderer fell back: {fallback}
          </Text>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Chip
            label="draw"
            value={flags.renderer === 'direct' ? 'direct' : 'react'}
            accent={flags.renderer !== DEFAULT_RENDERER}
            onPress={() => cycle('renderer', ['direct', 'react'])}
          />
          <Chip
            label="glow"
            value={flags.glow}
            accent={flags.glow !== 'mask'}
            onPress={() => cycle('glow', ['mask', 'grad'])}
          />
          <Chip
            label="res"
            value={flags.resScale === 1 ? '100%' : '75%'}
            accent={flags.resScale !== 1}
            onPress={() => cycle('resScale', [1, 0.75])}
          />
          <Chip
            label="cull"
            value={flags.cull ? 'on' : 'off'}
            accent={!flags.cull}
            onPress={() => setPerfFlags({ cull: !flags.cull })}
          />
          <Chip
            label="sim"
            value={flags.demoProgress === null ? 'live' : `bulk ${Math.round(flags.demoProgress * 100)}%`}
            accent={flags.demoProgress !== null}
            onPress={() => {
              const cur = SIM_STEPS.indexOf(flags.demoProgress);
              setPerfFlags({ demoProgress: SIM_STEPS[(cur + 1) % SIM_STEPS.length] });
            }}
          />
          <Chip label="✕" value="hide" onPress={() => setPerfFlags({ hud: false })} />
        </View>
      </View>
    </View>
  );
}

const DEFAULT_RENDERER: PerfFlags['renderer'] = 'direct';

export default PerfHud;
