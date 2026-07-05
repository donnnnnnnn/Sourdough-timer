/**
 * SkiaFermentationScene — SPIKE / proof-of-concept.
 *
 * Renders the "confocal microscopy" fermentation look with
 * @shopify/react-native-skia: luminous, semi-translucent organisms glowing
 * from within on pure black, composited with ADDITIVE blending (BlendMode.Plus).
 *
 * Scope of this spike is deliberately narrow — two specimens only:
 *   1. Yeast cells  — amber, glow-from-within, budding daughter.
 *                     Count + vigor driven by DoughState.microbeActivity.
 *   2. Gluten mesh  — orange filaments with glowing junction nodes.
 *                     Organizes as glutenStrength rises; frays/dims as
 *                     glutenDamage rises.
 *
 * Everything is driven by the existing pure-function engine in
 * model/doughState.ts — this component only CONSUMES it, never re-derives
 * fermentation logic.
 *
 * NOTE: This is the Skia component referenced by the spike. The screenshot in
 * scratchpad-spike/ was produced by the SAME drawing logic running on the same
 * underlying engine (CanvasKit — the WASM Skia build react-native-skia uses on
 * web), so the on-device look should match closely.
 */
import { useMemo } from 'react';
import {
  Canvas,
  Group,
  Circle,
  Path,
  RadialGradient,
  Blur,
  Skia,
  vec,
  type SkPath,
} from '@shopify/react-native-skia';
import {
  computeDoughState,
  DEFAULT_INPUTS,
  type BakerInputs,
  type FoldEvent,
} from '../model/doughState';

// ── Palette (matches FermentationScene / fermentation-art-spec.md) ──────────
const AMBER = 'rgb(232,163,61)';
const AMBER_CORE = 'rgb(246,208,138)';
const WHITE_HOT = 'rgb(255,251,240)';
const GLUTEN = 'rgb(232,163,61)';
const GLUTEN_HOT = 'rgb(255,214,150)';
const TRANSPARENT = 'rgba(232,163,61,0)';

// ── tiny deterministic PRNG so layout is stable frame-to-frame ──────────────
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Props {
  /** Fermentation progress 0..1 (elapsed / target bulk time). */
  progress: number;
  inputs?: BakerInputs;
  folds?: FoldEvent[];
  width?: number;
  height?: number;
}

interface YeastCell {
  x: number;
  y: number;
  r: number;
  bright: number;
  bud?: { x: number; y: number; r: number };
}
interface Node {
  x: number;
  y: number;
}
interface Strand {
  path: SkPath;
  width: number;
  alpha: number;
}

export function SkiaFermentationScene({
  progress,
  inputs = DEFAULT_INPUTS,
  folds = [],
  width = 360,
  height = 420,
}: Props) {
  const scene = useMemo(() => {
    const st = computeDoughState(progress, inputs, folds);
    return buildScene(st.microbeActivity, st.glutenStrength, st.glutenDamage, width, height);
  }, [progress, inputs, folds, width, height]);

  return (
    <Canvas style={{ width, height, backgroundColor: 'black' }}>
      {/* Additive layer — this is what produces the confocal glow. */}
      <Group blendMode="plus">
        {/* Gluten structure (behind) */}
        {scene.strands.map((s, i) => (
          <Path
            key={`s${i}`}
            path={s.path}
            style="stroke"
            strokeWidth={s.width}
            strokeCap="round"
            color={GLUTEN}
            opacity={s.alpha}
          >
            <Blur blur={lerp(0.6, 2.2, s.alpha)} />
          </Path>
        ))}
        {scene.nodes.map((n, i) => (
          <Group key={`n${i}`}>
            <Circle cx={n.x} cy={n.y} r={scene.nodeR * 2}>
              <RadialGradient
                c={vec(n.x, n.y)}
                r={scene.nodeR * 2}
                colors={[`rgba(232,163,61,${0.16 * scene.nodeAlive})`, TRANSPARENT]}
              />
            </Circle>
            <Circle cx={n.x} cy={n.y} r={scene.nodeR}>
              <RadialGradient
                c={vec(n.x, n.y)}
                r={scene.nodeR}
                colors={[GLUTEN_HOT, GLUTEN, TRANSPARENT]}
                positions={[0, 0.45, 1]}
              />
            </Circle>
          </Group>
        ))}

        {/* Yeast cells (front) */}
        {scene.yeast.map((y, i) => (
          <Group key={`y${i}`}>
            {/* outer halo bloom */}
            <Circle cx={y.x} cy={y.y} r={y.r * 1.9} opacity={0.18 * y.bright} color={AMBER}>
              <Blur blur={y.r * 0.55} />
            </Circle>
            {/* luminous body — glow from within */}
            <Circle cx={y.x} cy={y.y} r={y.r}>
              <RadialGradient
                c={vec(y.x, y.y)}
                r={y.r}
                colors={[WHITE_HOT, AMBER, TRANSPARENT]}
                positions={[0, 0.45, 1]}
              />
            </Circle>
            {/* specular highlight */}
            <Circle
              cx={y.x - y.r * 0.28}
              cy={y.y - y.r * 0.3}
              r={y.r * 0.14}
              color={WHITE_HOT}
              opacity={0.9 * y.bright}
            />
            {/* budding daughter */}
            {y.bud && (
              <Circle cx={y.bud.x} cy={y.bud.y} r={y.bud.r}>
                <RadialGradient
                  c={vec(y.bud.x, y.bud.y)}
                  r={y.bud.r}
                  colors={[WHITE_HOT, AMBER, TRANSPARENT]}
                  positions={[0, 0.5, 1]}
                />
              </Circle>
            )}
          </Group>
        ))}
      </Group>
    </Canvas>
  );
}

// ── Pure layout builder (mirrors the CanvasKit spike render) ────────────────
function buildScene(
  microbeActivity: number,
  glutenStrength: number,
  glutenDamage: number,
  W: number,
  H: number,
) {
  // Yeast
  const m = microbeActivity;
  const yrng = mulberry32(99);
  const count = Math.round(lerp(2, 8, m));
  const vigor = m;
  const yeast: YeastCell[] = [];
  for (let i = 0; i < count; i++) {
    const x = lerp(48, W - 48, yrng());
    const y = lerp(60, H - 60, yrng());
    const r = lerp(15, 23, yrng()) * lerp(0.75, 1.05, vigor);
    const bright = lerp(0.55, 1.0, vigor);
    const cell: YeastCell = { x, y, r, bright };
    if (vigor > 0.25) {
      const ba = Math.PI * lerp(-0.4, 0.4, yrng()) - 0.4;
      const bd = r * 0.95;
      cell.bud = { x: x + Math.cos(ba) * bd, y: y + Math.sin(ba) * bd, r: r * lerp(0.34, 0.6, vigor) };
    }
    yeast.push(cell);
  }

  // Gluten
  const organize = glutenStrength;
  const fray = glutenDamage;
  const grng = mulberry32(7);
  const COLS = 5,
    ROWS = 4;
  const x0 = 40,
    x1 = W - 40,
    y0 = 55,
    y1 = H - 45;
  const slack = 1 - organize;
  const nodes: Node[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const gx = lerp(x0, x1, c / (COLS - 1));
      const gy = lerp(y0, y1, r / (ROWS - 1));
      nodes.push({ x: gx + (grng() * 2 - 1) * 30 * slack, y: gy + (grng() * 2 - 1) * 26 * slack });
    }
  }
  const at = (c: number, r: number) => nodes[r * COLS + c];

  const strandAlpha = lerp(0.14, 0.6, organize) * (1 - 0.8 * fray);
  const strandW = lerp(1.0, 4.0, organize) * (1 - 0.55 * fray);
  const strands: Strand[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const n = at(c, r);
      const neigh: Node[] = [];
      if (c < COLS - 1) neigh.push(at(c + 1, r));
      if (r < ROWS - 1) neigh.push(at(c, r + 1));
      for (const nb of neigh) {
        if (strandAlpha < 0.01) continue;
        const path = Skia.Path.Make();
        if (fray > 0.35 && grng() < fray) {
          const mx = lerp(n.x, nb.x, 0.5),
            my = lerp(n.y, nb.y, 0.5);
          const g = lerp(0.12, 0.32, fray);
          const recoil = (grng() * 2 - 1) * 8 * fray;
          path.moveTo(n.x, n.y);
          path.quadTo(lerp(n.x, mx, 0.5), lerp(n.y, my, 0.5) + recoil, lerp(n.x, mx, 1 - g), lerp(n.y, my, 1 - g));
          path.moveTo(lerp(mx, nb.x, g), lerp(my, nb.y, g));
          path.quadTo(lerp(mx, nb.x, 0.5), lerp(my, nb.y, 0.5) - recoil, nb.x, nb.y);
          strands.push({ path, width: strandW, alpha: strandAlpha * 0.7 });
        } else {
          path.moveTo(n.x, n.y);
          path.lineTo(nb.x, nb.y);
          strands.push({ path, width: strandW, alpha: strandAlpha });
        }
      }
    }
  }

  const nodeAlive = clamp(organize * (1 - fray), 0, 1);
  const nodeR = lerp(2.0, 6.5, organize) * (1 - 0.6 * fray);

  return { yeast, nodes: nodeAlive < 0.04 ? [] : nodes, strands, nodeR, nodeAlive };
}

export default SkiaFermentationScene;
