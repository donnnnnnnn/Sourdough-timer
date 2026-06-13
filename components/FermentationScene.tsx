import { useEffect, useRef, type ReactNode } from 'react';
import { View, Animated, Easing } from 'react-native';

// ---------------------------------------------------------------------------
// Fermentation scene — one continuous, slowly-evolving tableau driven entirely
// by `fraction` (elapsed / target bulk time, 0..1+). All organisms are drawn
// with plain Views (no SVG) so they work identically on web and native.
// Looping animations use recursive callbacks instead of Animated.loop to avoid
// a React Native Web bug where loops stop after the first iteration.
// ---------------------------------------------------------------------------

export type SceneMode = 'idle' | 'autolyse' | 'bulk';

export interface PhaseCopy {
  title: string;
  science: string;
  sensory: string;
}

// Palette
const YEAST_BODY = '#E8A33D';
const YEAST_CORE = '#F6D08A';
const LAB_BODY = '#C9A8D6';
const LAB_CORE = '#E4CCEC';
const AMYLASE = '#6FB8A8';
const PROTEASE = '#E58C76';
const ACETIC = '#9FB36B';
const GLUTEN = '232,163,61';

export const AUTOLYSE_COPY: PhaseCopy = {
  title: 'Autolyse',
  science:
    "Just flour and water — no levain yet. The flour's own β-amylase is already cleaving damaged starch into maltose, stockpiling fuel, while proteases nick the gluten proteins so strands can slide and re-align on their own.",
  sensory:
    'The dough is shaggy and stiff now. Give it time and it turns smooth and silky, stretching without tearing — the gluten organizing itself before a single fold.',
};

export const PHASE_SCRIPT: PhaseCopy[] = [
  {
    title: 'Levain In',
    science:
      `Your ripe levain hits the dough at full strength — roughly 10:1 to 100:1 bacteria to yeast, all active from the first second. But the CO₂ they exhale dissolves into the dough's water first; it must saturate before a bubble can grow.`,
    sensory:
      `Looks like nothing is happening. The dough sits smooth and tight. Trust it — the engine is already running, you just can't see it.`,
  },
  {
    title: 'First Rise',
    science:
      `The dough water is saturated now, so CO₂ inflates the air pockets folded in during mixing. Kazachstania humilis can't eat maltose, so it lives on glucose the bacteria leak — a quiet cross-feeding partnership blowing the first bubbles.`,
    sensory:
      'A faint dome and the first bubbles at the surface. Folded, the dough feels alive — pillowy, starting to billow instead of resist.',
  },
  {
    title: 'The Bloom',
    science:
      'Acidity has fallen from ~5.8 toward 4.5, and in this window the dropping pH strengthens gluten, aligning strands into an elastic net that traps gas. Bacteria now far outnumber yeast; lactic acid is laying down the clean tang.',
    sensory:
      'Springy and elastic. It holds a fold, jiggles when nudged, and the surface tightens into a dome. Smells faintly sweet and yeasty.',
  },
  {
    title: 'The Sweet Spot',
    science:
      `Fructilactobacillus sanfranciscensis now diverts some output to acetic acid, layering a sharper note over the lactic. The gluten matrix is at peak gas-trapping strength — the maximum oven-spring window you're chasing.`,
    sensory:
      'Billowy and domed, jiggling like custard, pulling cleanly from the bowl with bubbles along the sides. The aroma turns tangy and ripe.',
  },
  {
    title: `The Knife's Edge`,
    science:
      `Below pH ~4.5 the proteases outpace gluten synthesis and bacterial glutathione snips the disulfide bonds holding the net together. Gas escapes faster than it's trapped — the structure is going slack.`,
    sensory:
      `Loose, sticky, over-billowed; bubbles popping at the surface and the dough slumping rather than holding its edge. Shape now — or pull it earlier next time.`,
  },
];

const PHASE_BOUNDS = [0.15, 0.4, 0.65, 0.85];

export function bulkPhaseIndex(fraction: number): number {
  for (let i = 0; i < PHASE_BOUNDS.length; i++) if (fraction < PHASE_BOUNDS[i]) return i;
  return PHASE_BOUNDS.length;
}

function clamp01(x: number) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

// ---------------------------------------------------------------------------
// Reliable looping animation — uses recursive callbacks instead of
// Animated.loop, which silently stops after one iteration on React Native Web.
// ---------------------------------------------------------------------------
function startLoop(
  anim: Animated.Value,
  from: number,
  to: number,
  duration: number,
  easing: (t: number) => number,
  alive: { current: boolean },
) {
  anim.setValue(from);
  Animated.timing(anim, { toValue: to, duration, easing, useNativeDriver: false }).start(({ finished }) => {
    if (finished && alive.current) startLoop(anim, from, to, duration, easing, alive);
  });
}

function usePingPong(seed: number, duration = 3500) {
  const t = useRef(new Animated.Value(0)).current;
  const alive = useRef(true);
  useEffect(() => {
    const d = duration + (seed % 5) * 400;
    const delay = (seed % 7) * 200;
    let forward = true;
    const tick = () => {
      if (!alive.current) return;
      const [from, to] = forward ? [0, 1] : [1, 0];
      forward = !forward;
      Animated.timing(t, { toValue: to, duration: d, easing: Easing.inOut(Easing.sin), useNativeDriver: false }).start(
        ({ finished }) => { if (finished && alive.current) tick(); },
      );
    };
    const timer = setTimeout(tick, delay);
    return () => { alive.current = false; clearTimeout(timer); };
  }, [t, seed, duration]);
  return t;
}

function useSweep(seed: number, duration = 6000) {
  const t = useRef(new Animated.Value(0)).current;
  const alive = useRef(true);
  useEffect(() => {
    const d = duration + (seed % 5) * 500;
    const delay = (seed % 9) * 250;
    alive.current = true;
    const timer = setTimeout(() => startLoop(t, 0, 1, d, Easing.inOut(Easing.sin), alive), delay);
    return () => { alive.current = false; clearTimeout(timer); };
  }, [t, seed, duration]);
  return t;
}

// ---------------------------------------------------------------------------
// Organism shapes — all plain Views, no SVG dependency.
// ---------------------------------------------------------------------------

/** Kazachstania humilis: amber oval body + budding daughter cell. */
function YeastCell({ size, seed, vigor }: { size: number; seed: number; vigor: number }) {
  const bud = usePingPong(seed, 3000);
  const budMaxScale = lerp(0.28, 0.65, vigor);
  return (
    <View style={{ width: size, height: size }}>
      {/* body */}
      <View style={{
        position: 'absolute', left: size * 0.1, top: size * 0.05,
        width: size * 0.7, height: size * 0.85,
        borderRadius: size * 0.4,
        backgroundColor: YEAST_BODY, opacity: 0.55,
        borderWidth: 1.5, borderColor: YEAST_BODY,
      }} />
      {/* nucleus highlight */}
      <View style={{
        position: 'absolute', left: size * 0.38, top: size * 0.20,
        width: size * 0.22, height: size * 0.22,
        borderRadius: size * 0.11, backgroundColor: YEAST_CORE, opacity: 0.9,
      }} />
      {/* bud */}
      <Animated.View style={{
        position: 'absolute', right: 0, top: 0,
        width: size * 0.45, height: size * 0.45,
        borderRadius: size * 0.225,
        backgroundColor: YEAST_BODY, opacity: 0.5,
        borderWidth: 1, borderColor: YEAST_BODY,
        transform: [{ scale: bud.interpolate({ inputRange: [0, 1], outputRange: [0.1, budMaxScale] }) }],
      }} />
    </View>
  );
}

/** F. sanfranciscensis: chain of lavender capsules. */
function LabRod({ size, chain }: { size: number; chain: number }) {
  const capsuleW = Math.floor(size / chain) - 2;
  const capsuleH = Math.max(10, Math.floor(capsuleW * 0.45));
  return (
    <View style={{ flexDirection: 'row', gap: 2, alignItems: 'center' }}>
      {Array.from({ length: chain }).map((_, i) => (
        <View key={i} style={{
          width: capsuleW, height: capsuleH,
          borderRadius: capsuleH / 2,
          backgroundColor: LAB_BODY, opacity: 0.6,
          borderWidth: 1, borderColor: LAB_CORE,
          justifyContent: 'center', alignItems: 'center',
        }}>
          <View style={{
            width: capsuleW * 0.55, height: capsuleH * 0.3,
            borderRadius: capsuleH * 0.15, backgroundColor: LAB_CORE, opacity: 0.5,
          }} />
        </View>
      ))}
    </View>
  );
}

/** Amylase: teal torus (ring shape). */
function AmylaseEnzyme({ size }: { size: number }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      borderWidth: size * 0.22, borderColor: AMYLASE,
      opacity: 0.7,
    }} />
  );
}

/** Protease: two coral lobes. */
function ProteaseEnzyme({ size }: { size: number }) {
  const lobeSize = size * 0.6;
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: lobeSize, height: lobeSize, borderRadius: lobeSize / 2, backgroundColor: PROTEASE, opacity: 0.55 }} />
        <View style={{ width: lobeSize * 0.8, height: lobeSize * 0.8, marginTop: lobeSize * 0.1, marginLeft: -lobeSize * 0.2, borderRadius: lobeSize * 0.4, backgroundColor: PROTEASE, opacity: 0.5 }} />
      </View>
    </View>
  );
}

/** Acetic acid: green angular chevron. */
function AceticMolecule({ size }: { size: number }) {
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View style={{
        width: size * 0.7, height: size * 0.7,
        borderLeftWidth: size * 0.12, borderBottomWidth: size * 0.12,
        borderColor: ACETIC, opacity: 0.8,
        transform: [{ rotate: '-45deg' }],
      }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Floater — positions and drifts an organism, emerging it smoothly.
// ---------------------------------------------------------------------------
function Floater({
  left, top, size, seed, emerge, range = 10, period = 6000, children,
}: {
  left: string; top: string; size: number; seed: number;
  emerge: number; range?: number; period?: number; children: ReactNode;
}) {
  const t = useSweep(seed, period);
  if (emerge <= 0.001) return null;
  const dir = seed % 2 === 0 ? 1 : -1;
  const e = Math.max(0.15, emerge);
  return (
    <View style={{
      position: 'absolute',
      left: left as `${number}%`,
      top: top as `${number}%`,
      width: size,
      height: size,
      opacity: 0.4 + 0.6 * e,
      transform: [{ scale: 0.5 + 0.5 * e }],
    }}>
      <Animated.View style={{
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, range * dir, 0] }) },
          { translateY: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -range * 0.7, 0] }) },
          { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${dir * 10}deg`] }) },
        ],
      }}>
        {children}
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Gluten strand — a horizontal wave that thickens then goes dashed (fraying).
// ---------------------------------------------------------------------------
function GlutenStrand({ top, seed, strength }: { top: string; seed: number; strength: number }) {
  const t = usePingPong(seed, 3200);
  if (strength <= 0.001) return null;
  const h = 2 + strength * 3;
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', left: '6%', right: '6%', top: top as `${number}%`,
      height: h, borderRadius: h / 2,
      backgroundColor: `rgba(${GLUTEN},0.45)`,
      opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.25 * strength, 0.55 * strength] }),
      transform: [{ scaleY: t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.0] }) }],
    }} />
  );
}

// ---------------------------------------------------------------------------
// CO2 Bubble — lifecycle driven by fraction.
// ---------------------------------------------------------------------------
function Bubble({ left, seed, fraction }: { left: string; seed: number; fraction: number }) {
  const t = useSweep(seed, 4200 + (seed % 6) * 400);
  const grown = smoothstep(0.05, 0.55, fraction);
  const escape = smoothstep(0.6, 1.0, fraction);
  const size = lerp(4, 18, grown) + (seed % 3);
  const rise = lerp(30, 200, grown);
  const peak = lerp(0.3, 0.8, grown);
  const drift = 5 + (seed % 4) * 4;
  const hl = size * 0.3;
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', bottom: 0, left: left as `${number}%`,
      opacity: t.interpolate({ inputRange: [0, 0.12, 0.78, 1], outputRange: [0, peak, peak, 0] }),
      transform: [
        { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -rise] }) },
        { translateX: t.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, drift, 0, -drift, 0] }) },
        { scale: t.interpolate({ inputRange: [0, 0.85, 1], outputRange: [0.5, 1, lerp(1, 1.45, escape)] }) },
      ],
    }}>
      <View style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: `rgba(${GLUTEN},${lerp(0.08, 0.16, grown)})`,
        borderWidth: 1, borderColor: `rgba(${GLUTEN},${lerp(0.4, 0.65, grown)})`,
      }}>
        <View style={{
          position: 'absolute', top: size * 0.15, left: size * 0.20,
          width: hl, height: hl, borderRadius: hl / 2,
          backgroundColor: 'rgba(255,255,255,0.45)',
        }} />
      </View>
    </Animated.View>
  );
}

// Layout tables
const YEAST = [
  { left: '14%', top: '42%', size: 40, seed: 1, born: 0.0 },
  { left: '70%', top: '28%', size: 34, seed: 2, born: 0.0 },
  { left: '48%', top: '58%', size: 46, seed: 3, born: 0.08 },
  { left: '82%', top: '54%', size: 30, seed: 4, born: 0.3 },
  { left: '30%', top: '18%', size: 32, seed: 5, born: 0.5 },
];
const RODS = [
  { left: '20%', top: '68%', size: 64, chain: 3, seed: 11, born: 0.0 },
  { left: '60%', top: '74%', size: 46, chain: 2, seed: 12, born: 0.0 },
  { left: '8%',  top: '28%', size: 50, chain: 2, seed: 13, born: 0.12 },
  { left: '78%', top: '42%', size: 58, chain: 3, seed: 14, born: 0.3 },
  { left: '44%', top: '34%', size: 42, chain: 2, seed: 15, born: 0.45 },
  { left: '64%', top: '12%', size: 54, chain: 3, seed: 16, born: 0.6 },
];
const ENZYMES = [
  { left: '18%', top: '22%', size: 26, kind: 'amylase', seed: 21 },
  { left: '74%', top: '64%', size: 22, kind: 'protease', seed: 22 },
  { left: '40%', top: '78%', size: 24, kind: 'amylase', seed: 23 },
  { left: '88%', top: '18%', size: 20, kind: 'protease', seed: 24 },
  { left: '54%', top: '46%', size: 24, kind: 'amylase', seed: 25 },
];
const ACETICS = [
  { left: '34%', top: '38%', seed: 31 },
  { left: '68%', top: '52%', seed: 32 },
  { left: '20%', top: '58%', seed: 33 },
];
const BUBBLES = Array.from({ length: 16 }).map((_, i) => ({
  left: `${6 + ((i * 37) % 88)}%`, seed: i + 1, born: (i % 8) * 0.07,
}));

export function FermentationScene({ mode, fraction = 0 }: { mode: SceneMode; fraction?: number }) {
  const bulk = mode === 'bulk';
  const autolyse = mode === 'autolyse';
  const f = bulk ? fraction : 0;

  const yeastVigor = smoothstep(0.1, 0.45, f) * (1 - 0.35 * smoothstep(0.7, 1, f));
  const glutenForm = smoothstep(0.15, 0.55, f);
  const glutenFray = smoothstep(0.8, 1.05, f);
  const glutenStrength = glutenForm * (1 - 0.45 * glutenFray);
  const aceticEmerge = smoothstep(0.58, 0.8, f);
  const glowOpacity = autolyse ? 0.045 : 0.04 + 0.13 * clamp01(f);
  const enzymeEmerge = autolyse
    ? 1
    : Math.max(1 - smoothstep(0.04, 0.16, f), 0.6 * smoothstep(0.82, 0.96, f));

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}>
      {/* DEBUG: plain marker (tests container). Solid red square, top-left. */}
      {bulk && (
        <View style={{ position: 'absolute', left: '2%', top: '2%', width: 30, height: 30, backgroundColor: 'red' }} />
      )}
      {/* DEBUG: Floater marker (tests organism path). Solid blue square, center. */}
      {bulk && (
        <Floater left="46%" top="46%" size={30} seed={99} emerge={1} range={12} period={5000}>
          <View style={{ width: 30, height: 30, backgroundColor: 'blue' }} />
        </Floater>
      )}
      {/* warm dough glow */}
      <View style={{
        position: 'absolute', bottom: -60, alignSelf: 'center',
        width: 320, height: 140, borderRadius: 160,
        backgroundColor: `rgba(${GLUTEN},${glowOpacity})`,
      }} />

      {/* gluten strands */}
      {bulk && ['26%', '44%', '62%', '78%'].map((top, i) => (
        <GlutenStrand key={`g-${i}`} top={top} seed={i + 1} strength={glutenStrength} />
      ))}

      {/* enzymes */}
      {enzymeEmerge > 0.01 && ENZYMES.map((e) => (
        <Floater key={`e-${e.seed}`} left={e.left} top={e.top} size={e.size} seed={e.seed} emerge={enzymeEmerge} range={14} period={7000}>
          {e.kind === 'amylase' ? <AmylaseEnzyme size={e.size} /> : <ProteaseEnzyme size={e.size} />}
        </Floater>
      ))}

      {/* yeast */}
      {bulk && YEAST.map((y) => (
        <Floater key={`y-${y.seed}`} left={y.left} top={y.top} size={y.size} seed={y.seed} emerge={smoothstep(y.born, y.born + 0.12, f)} range={9} period={6500}>
          <YeastCell size={y.size} seed={y.seed} vigor={yeastVigor} />
        </Floater>
      ))}

      {/* LAB rods */}
      {bulk && RODS.map((r) => (
        <Floater key={`r-${r.seed}`} left={r.left} top={r.top} size={r.size} seed={r.seed} emerge={smoothstep(r.born, r.born + 0.14, f)} range={11} period={5800}>
          <LabRod size={r.size} chain={r.chain} />
        </Floater>
      ))}

      {/* acetic flecks */}
      {bulk && aceticEmerge > 0.01 && ACETICS.map((a) => (
        <Floater key={`a-${a.seed}`} left={a.left} top={a.top} size={16} seed={a.seed} emerge={aceticEmerge} range={16} period={5200}>
          <AceticMolecule size={16} />
        </Floater>
      ))}

      {/* CO2 bubbles */}
      {bulk && BUBBLES.filter((b) => f >= b.born - 0.02).map((b, i) => (
        <Bubble key={`b-${i}`} left={b.left} seed={b.seed} fraction={f} />
      ))}
    </View>
  );
}
