import { useEffect, useRef, type ReactNode } from 'react';
import { View, Animated, Easing, Platform } from 'react-native';
import Svg, { Ellipse, Circle, Rect, Path, G, Defs, RadialGradient, Stop } from 'react-native-svg';

const nativeDriver = Platform.OS !== 'web';

// ---------------------------------------------------------------------------
// Fermentation scene — one continuous, slowly-evolving tableau driven entirely
// by `fraction` (elapsed / target bulk time, 0..1+). Nothing fades between
// discrete phases; every property — bubble size, bacterial population, gluten
// thickness, warmth, acid flecks — is a smooth function of how far along the
// bulk is. Because a 4h bulk advances `fraction` by ~0.0007/sec, the scene
// morphs in genuine slow motion: a baker can glance and read progress from the
// dough itself.
//
// The biology is grounded in primary literature — De Vuyst et al. (2014/2017)
// for population dynamics, Gänzle (2014) for enzyme/metabolite conversions,
// Gobbetti et al. (2002) and Thiele et al. (2002) for proteolysis/gluten, and
// the Kazachstania humilis review (Trends in Microbiology 2022). Shapes are
// stylized to be recognizable to a microbiologist (heterofermentative rod-LAB,
// elongated multilaterally-budding yeast, TIM-barrel amylase, two-lobed serine
// protease) yet warm and appetizing to a baker.
// ---------------------------------------------------------------------------

export type SceneMode = 'idle' | 'autolyse' | 'bulk';

export interface PhaseCopy {
  title: string;
  /** What's happening microscopically — the mechanism. */
  science: string;
  /** What you'd see/feel/smell in the bowl — phenomenological (Tartine-style). */
  sensory: string;
}

// Stylized but accurate palette ----------------------------------------------
const YEAST_BODY = '#E8A33D'; // honey amber — Kazachstania humilis
const YEAST_CORE = '#F6D08A';
const LAB_BODY = '#C9A8D6'; // rose-lavender (Gram-stain nod) — F. sanfranciscensis
const LAB_CORE = '#E4CCEC';
const AMYLASE = '#6FB8A8'; // blue-green TIM-barrel
const PROTEASE = '#E58C76'; // coral two-lobed serine protease
const ACETIC = '#9FB36B'; // angular acetic-acid molecule fleck
const GLUTEN = '232,163,61'; // honey, used as rgba base

// ---------------------------------------------------------------------------
// Phase script — captions only. Visuals are continuous; these texts snap at
// the boundaries below. Activity is MAXIMAL from t=0 (ripe levain): the early
// phases describe the *lag before visible result*, not a microbial lag.
// ---------------------------------------------------------------------------

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
      'Your ripe levain hits the dough at full strength — roughly 10:1 to 100:1 bacteria to yeast, all active from the first second. But the CO₂ they exhale dissolves into the dough’s water first; it must saturate before a bubble can grow.',
    sensory:
      'Looks like nothing is happening. The dough sits smooth and tight. Trust it — the engine is already running, you just can’t see it.',
  },
  {
    title: 'First Rise',
    science:
      'The dough water is saturated now, so CO₂ inflates the air pockets folded in during mixing. Kazachstania humilis can’t eat maltose, so it lives on glucose the bacteria leak — a quiet cross-feeding partnership blowing the first bubbles.',
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
      'Fructilactobacillus sanfranciscensis now diverts some output to acetic acid, layering a sharper note over the lactic. The gluten matrix is at peak gas-trapping strength — the maximum oven-spring window you’re chasing.',
    sensory:
      'Billowy and domed, jiggling like custard, pulling cleanly from the bowl with bubbles along the sides. The aroma turns tangy and ripe.',
  },
  {
    title: 'The Knife’s Edge',
    science:
      'Below pH ~4.5 the proteases outpace gluten synthesis and bacterial glutathione snips the disulfide bonds holding the net together. Gas escapes faster than it’s trapped — the structure is going slack.',
    sensory:
      'Loose, sticky, over-billowed; bubbles popping at the surface and the dough slumping rather than holding its edge. Shape now — or pull it earlier next time.',
  },
];

const PHASE_BOUNDS = [0.15, 0.4, 0.65, 0.85];

/** Map a bulk fraction to a caption phase index 0–4. */
export function bulkPhaseIndex(fraction: number): number {
  for (let i = 0; i < PHASE_BOUNDS.length; i++) if (fraction < PHASE_BOUNDS[i]) return i;
  return PHASE_BOUNDS.length;
}

// Continuous helpers ----------------------------------------------------------
function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
/** Smooth 0→1 ramp between edge0 and edge1 (Hermite). */
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// A looping drift that makes organisms feel suspended. Loops are keyed only on
// `seed` so they NEVER restart as `fraction` changes — that keeps the scene's
// slow morph perfectly smooth.
// ---------------------------------------------------------------------------
function useDrift(seed: number, range = 10, period = 6000) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: period + (seed % 5) * 600,
        delay: (seed % 7) * 220,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: nativeDriver,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [t, period, seed]);

  const dir = seed % 2 === 0 ? 1 : -1;
  return [
    { translateX: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, range * dir, 0] }) },
    { translateY: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -range * 0.7, 0] }) },
    { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${dir * 12}deg`] }) },
  ];
}

// ---------------------------------------------------------------------------
// Organism SVGs (drawn around a 100x100 local box).
// ---------------------------------------------------------------------------

/** Kazachstania humilis: elongated oval, nucleus + vacuole, a multilateral bud
 *  that swells and pinches off. `vigor` scales the budding amplitude. */
function YeastCell({ size, seed, vigor }: { size: number; seed: number; vigor: number }) {
  const bud = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bud, { toValue: 1, duration: 3200, delay: (seed % 5) * 500, easing: Easing.inOut(Easing.ease), useNativeDriver: nativeDriver }),
        Animated.timing(bud, { toValue: 0, duration: 700, easing: Easing.in(Easing.ease), useNativeDriver: nativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bud, seed]);

  const budScale = bud.interpolate({ inputRange: [0, 1], outputRange: [0.12, lerp(0.3, 0.66, vigor)] });
  const budOpacity = bud.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.6, 1] });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={`yeast-${seed}`} cx="42%" cy="38%" r="70%">
            <Stop offset="0%" stopColor={YEAST_CORE} stopOpacity={0.9} />
            <Stop offset="60%" stopColor={YEAST_BODY} stopOpacity={0.55} />
            <Stop offset="100%" stopColor={YEAST_BODY} stopOpacity={0.28} />
          </RadialGradient>
        </Defs>
        <Ellipse cx="48" cy="52" rx="34" ry="40" fill={`url(#yeast-${seed})`} stroke={YEAST_BODY} strokeWidth={2} strokeOpacity={0.7} />
        <Circle cx="40" cy="64" r="13" fill={YEAST_BODY} fillOpacity={0.16} />
        <Circle cx="55" cy="42" r="7" fill={YEAST_CORE} fillOpacity={0.95} />
      </Svg>
      <Animated.View
        style={{
          position: 'absolute',
          top: size * 0.04,
          right: size * 0.02,
          width: size * 0.5,
          height: size * 0.5,
          opacity: budOpacity,
          transform: [{ scale: budScale }],
        }}>
        <Svg width={size * 0.5} height={size * 0.5} viewBox="0 0 100 100">
          <Circle cx="50" cy="50" r="42" fill={YEAST_BODY} fillOpacity={0.42} stroke={YEAST_BODY} strokeWidth={3} strokeOpacity={0.7} />
          <Circle cx="44" cy="44" r="12" fill={YEAST_CORE} fillOpacity={0.85} />
        </Svg>
      </Animated.View>
    </View>
  );
}

/** Heterofermentative LAB rod (F. sanfranciscensis): slender capsule chain. */
function LabRod({ size, chain, seed }: { size: number; chain: number; seed: number }) {
  const capH = (size / chain) * 0.5;
  return (
    <Svg width={size} height={capH} viewBox={`0 0 ${chain * 100} 50`}>
      <Defs>
        <RadialGradient id={`lab-${seed}`} cx="50%" cy="40%" r="70%">
          <Stop offset="0%" stopColor={LAB_CORE} stopOpacity={0.95} />
          <Stop offset="100%" stopColor={LAB_BODY} stopOpacity={0.5} />
        </RadialGradient>
      </Defs>
      {Array.from({ length: chain }).map((_, i) => (
        <G key={i}>
          <Rect x={i * 100 + 4} y={6} width={92} height={38} rx={19} fill={`url(#lab-${seed})`} stroke={LAB_BODY} strokeWidth={2} strokeOpacity={0.7} />
          <Rect x={i * 100 + 12} y={12} width={76} height={9} rx={4} fill={LAB_CORE} fillOpacity={0.35} />
        </G>
      ))}
    </Svg>
  );
}

/** Amylase: TIM-barrel as a torus with an active-site cleft. */
function AmylaseEnzyme({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx="50" cy="50" r="40" fill={AMYLASE} fillOpacity={0.32} stroke={AMYLASE} strokeWidth={3} strokeOpacity={0.75} />
      <Circle cx="50" cy="50" r="17" fill="transparent" stroke={AMYLASE} strokeWidth={3} strokeOpacity={0.6} />
      <Path d="M50 10 L58 30 L42 30 Z" fill={AMYLASE} fillOpacity={0.55} />
    </Svg>
  );
}

/** Protease: two rounded lobes with a deep active-site cleft. */
function ProteaseEnzyme({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d="M50 50 L88 22 A45 45 0 1 1 88 78 Z" fill={PROTEASE} fillOpacity={0.34} stroke={PROTEASE} strokeWidth={3} strokeOpacity={0.75} />
      <Circle cx="40" cy="50" r="7" fill={PROTEASE} fillOpacity={0.7} />
    </Svg>
  );
}

/** Angular acetic-acid molecule fleck — the late tang. */
function AceticMolecule({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d="M20 70 L50 30 L80 70" fill="none" stroke={ACETIC} strokeWidth={6} strokeOpacity={0.85} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="50" cy="30" r="8" fill={ACETIC} fillOpacity={0.85} />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Floater: positions an organism, drifts it, and continuously "emerges" it
// (scale + opacity grow together) by a 0..1 scalar — no opacity pops, so new
// organisms grow into the scene as the population builds.
// ---------------------------------------------------------------------------
function Floater({
  left,
  top,
  size,
  seed,
  emerge,
  range,
  period,
  children,
}: {
  left: string;
  top: string;
  size: number;
  seed: number;
  emerge: number; // 0..1
  range?: number;
  period?: number;
  children: ReactNode;
}) {
  const drift = useDrift(seed, range, period);
  if (emerge <= 0.001) return null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: left as `${number}%`, top: top as `${number}%`, width: size, height: size }}>
      <Animated.View style={{ opacity: 0.35 + 0.65 * emerge, transform: [...drift, { scale: 0.4 + 0.6 * emerge }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Bubble: a glassy CO₂ bubble whose whole life-cycle is a continuous function
// of `fraction`. Early bulk: small, barely rises, fades before the top (gas
// dissolving into solution). Mid: nucleates and rises. Late: large and pops
// (escaping a slackening net). One looping Animated.Value per bubble; the
// fraction-derived size/rise/escape feed the interpolation output ranges, so
// the look morphs without ever restarting the loop.
// ---------------------------------------------------------------------------
function Bubble({ left, seed, fraction }: { left: string; seed: number; fraction: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: 4200 + (seed % 6) * 500,
        delay: (seed % 9) * 260,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: nativeDriver,
      }),
      { resetBeforeIteration: true },
    );
    loop.start();
    return () => loop.stop();
  }, [t, seed]);

  // Continuous life-cycle parameters.
  const grown = smoothstep(0.05, 0.55, fraction); // dissolving → rising
  const escape = smoothstep(0.6, 1.0, fraction); // retained → popping
  const size = lerp(4, 20, grown) + (seed % 3);
  const rise = lerp(34, 230, grown);
  const peak = lerp(0.32, 0.85, grown);
  const drift = 6 + (seed % 4) * 4;
  const hl = size * 0.32;

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -rise] });
  const translateX = t.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, drift, 0, -drift, 0] });
  // Early: fade out mid-rise (dissolving). Late: hold then pop at the top.
  const opacity = t.interpolate({
    inputRange: [0, 0.12, lerp(0.45, 0.78, escape), 1],
    outputRange: [0, peak, peak, 0],
  });
  const scale = t.interpolate({ inputRange: [0, 0.85, 1], outputRange: [0.5, 1, lerp(1, 1.5, escape)] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        bottom: 0,
        left: left as `${number}%`,
        opacity,
        transform: [{ translateY }, { translateX }, { scale }],
      }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: `rgba(${GLUTEN},${lerp(0.1, 0.18, grown)})`,
          borderWidth: 1,
          borderColor: `rgba(${GLUTEN},${lerp(0.4, 0.7, grown)})`,
        }}>
        <View
          style={{
            position: 'absolute',
            top: size * 0.16,
            left: size * 0.2,
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

/** A cross-linking gluten strand: thickens as the net forms, then frays. */
function GlutenStrand({ top, seed, strength, fray }: { top: string; seed: number; strength: number; fray: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 3400 + (seed % 4) * 500, easing: Easing.inOut(Easing.sin), useNativeDriver: nativeDriver }),
        Animated.timing(t, { toValue: 0, duration: 3400 + (seed % 4) * 500, easing: Easing.inOut(Easing.sin), useNativeDriver: nativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, seed]);
  if (strength <= 0.001) return null;
  // A frayed net reads as a gappy dashed line; a strong net is a solid wave.
  const dash = fray > 0.05 ? `${lerp(40, 8, fray)} ${lerp(2, 12, fray)}` : undefined;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: '6%',
        right: '6%',
        top: top as `${number}%`,
        opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.28 * strength, 0.6 * strength] }),
        transform: [{ scaleY: t.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
      }}>
      <Svg width="100%" height={14} viewBox="0 0 300 14" preserveAspectRatio="none">
        <Path
          d="M0 7 Q 37 0 75 7 T 150 7 T 225 7 T 300 7"
          fill="none"
          stroke={`rgba(${GLUTEN},0.55)`}
          strokeWidth={1.5 + strength * 2}
          strokeLinecap="round"
          strokeDasharray={dash}
        />
      </Svg>
    </Animated.View>
  );
}

// Stable instance layouts. `born` = the fraction at which an organism starts to
// emerge (population building over time); LAB and yeast that are present from
// the ripe levain have born≈0.
const YEAST = [
  { left: '14%', top: '46%', size: 40, seed: 1, born: 0.0 },
  { left: '70%', top: '30%', size: 34, seed: 2, born: 0.0 },
  { left: '48%', top: '60%', size: 46, seed: 3, born: 0.08 },
  { left: '82%', top: '56%', size: 30, seed: 4, born: 0.3 },
  { left: '30%', top: '20%', size: 32, seed: 5, born: 0.5 },
];
const RODS = [
  { left: '20%', top: '72%', size: 64, chain: 3, seed: 11, born: 0.0 },
  { left: '60%', top: '78%', size: 46, chain: 2, seed: 12, born: 0.0 },
  { left: '8%', top: '30%', size: 50, chain: 2, seed: 13, born: 0.12 },
  { left: '78%', top: '44%', size: 58, chain: 3, seed: 14, born: 0.3 },
  { left: '44%', top: '36%', size: 42, chain: 2, seed: 15, born: 0.45 },
  { left: '64%', top: '14%', size: 54, chain: 3, seed: 16, born: 0.6 },
];
const ENZYMES = [
  { left: '18%', top: '24%', size: 26, kind: 'amylase', seed: 21 },
  { left: '74%', top: '66%', size: 22, kind: 'protease', seed: 22 },
  { left: '40%', top: '80%', size: 24, kind: 'amylase', seed: 23 },
  { left: '88%', top: '20%', size: 20, kind: 'protease', seed: 24 },
  { left: '54%', top: '48%', size: 24, kind: 'amylase', seed: 25 },
];
const ACETICS = [
  { left: '34%', top: '40%', seed: 31 },
  { left: '68%', top: '54%', seed: 32 },
  { left: '20%', top: '60%', seed: 33 },
];
const BUBBLES = Array.from({ length: 16 }).map((_, i) => ({ left: `${6 + ((i * 37) % 88)}%`, seed: i + 1, born: (i % 8) * 0.07 }));

/**
 * The living scene. `fraction` (0..1+) drives everything continuously. In
 * 'autolyse' mode it shows only enzymes working the flour (no levain yet);
 * in 'bulk' mode the full ecosystem evolves with the dough.
 */
export function FermentationScene({ mode, fraction = 0 }: { mode: SceneMode; fraction?: number }) {
  const bulk = mode === 'bulk';
  const autolyse = mode === 'autolyse';
  const f = bulk ? fraction : 0;

  // Continuous field parameters.
  const yeastVigor = smoothstep(0.1, 0.45, f) * (1 - 0.35 * smoothstep(0.7, 1, f)); // peaks mid, eases late
  const glutenForm = smoothstep(0.15, 0.55, f);
  const glutenFray = smoothstep(0.8, 1.05, f);
  const glutenStrength = glutenForm * (1 - 0.45 * glutenFray);
  const aceticEmerge = smoothstep(0.58, 0.8, f);
  const glowOpacity = autolyse ? 0.045 : 0.04 + 0.13 * clamp01(f);
  // Enzymes: faintly present at the very start of bulk (carryover) and again
  // late as proteases dominate; full presence during autolyse.
  const enzymeEmerge = autolyse
    ? 1
    : Math.max(1 - smoothstep(0.04, 0.16, f), 0.6 * smoothstep(0.82, 0.96, f));

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden' }}>
      <View
        style={{
          position: 'absolute',
          bottom: -60,
          alignSelf: 'center',
          width: 320,
          height: 140,
          borderRadius: 160,
          backgroundColor: `rgba(${GLUTEN},${glowOpacity})`,
        }}
      />

      {/* gluten net — thickens then frays */}
      {bulk &&
        ['28%', '46%', '64%', '80%'].map((top, i) => (
          <GlutenStrand key={`g-${i}`} top={top} seed={i + 1} strength={glutenStrength} fray={glutenFray} />
        ))}

      {/* enzymes */}
      {enzymeEmerge > 0.01 &&
        ENZYMES.map((e) => (
          <Floater key={`e-${e.seed}`} left={e.left} top={e.top} size={e.size} seed={e.seed} emerge={enzymeEmerge} range={14} period={7000}>
            {e.kind === 'amylase' ? <AmylaseEnzyme size={e.size} /> : <ProteaseEnzyme size={e.size} />}
          </Floater>
        ))}

      {/* yeast + bacteria — grow in as the population builds */}
      {bulk &&
        YEAST.map((y) => (
          <Floater key={`y-${y.seed}`} left={y.left} top={y.top} size={y.size} seed={y.seed} emerge={smoothstep(y.born, y.born + 0.12, f)} range={9} period={6500}>
            <YeastCell size={y.size} seed={y.seed} vigor={yeastVigor} />
          </Floater>
        ))}
      {bulk &&
        RODS.map((r) => (
          <Floater key={`r-${r.seed}`} left={r.left} top={r.top} size={r.size} seed={r.seed} emerge={smoothstep(r.born, r.born + 0.14, f)} range={11} period={5800}>
            <LabRod size={r.size} chain={r.chain} seed={r.seed} />
          </Floater>
        ))}

      {/* acetic-acid flecks (late tang) */}
      {bulk &&
        aceticEmerge > 0.01 &&
        ACETICS.map((a) => (
          <Floater key={`a-${a.seed}`} left={a.left} top={a.top} size={16} seed={a.seed} emerge={aceticEmerge} range={16} period={5200}>
            <AceticMolecule size={16} />
          </Floater>
        ))}

      {/* CO₂ bubbles — life-cycle morphs with fraction */}
      {bulk &&
        BUBBLES.filter((b) => f >= b.born - 0.02).map((b, i) => <Bubble key={`b-${i}`} left={b.left} seed={b.seed} fraction={f} />)}
    </View>
  );
}
