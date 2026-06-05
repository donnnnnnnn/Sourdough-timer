/**
 * Sourdough crumb & shape diagnostic training data.
 * Compiled from: The Sourdough Journey, The Perfect Loaf, Trevor Jay Wilson,
 * The Bread Code (Hendrik Kleinwächter), Challenger Breadware, King Arthur,
 * The Fresh Loaf community consensus, and various expert sources.
 *
 * This file defines the diagnostic taxonomy, visual feature descriptors,
 * and fusion rules used by the on-device classifier.
 */

// ─── Fermentation-State Axis (primary diagnostic) ─────────────────────

export type FermentationState =
  | 'under_fermented'
  | 'slightly_under'
  | 'properly_fermented'
  | 'slightly_over'
  | 'over_fermented';

// ─── Shape Diagnosis ───────────────────────────────────────────────────

export type ShapeDiagnosis =
  | 'good_structure'
  | 'weak_shaping'
  | 'overproofed_collapse';

// ─── Combined Diagnosis (what we show the user) ────────────────────────

export type Diagnosis =
  | 'under_fermented'
  | 'slightly_under'
  | 'properly_fermented'
  | 'slightly_over'
  | 'over_fermented'
  | 'weak_shaping'
  | 'fools_crumb';

// ─── Visual Feature Descriptors ────────────────────────────────────────
// These map to what a CNN extracts from crumb/exterior photos.

export interface CrumbFeatures {
  holeDistribution: 'even' | 'top_heavy' | 'bottom_dense' | 'uniform_tight' | 'uniform_open';
  holeSizeVariance: 'low' | 'medium' | 'high';
  dominantHoleSize: 'micro' | 'small' | 'medium' | 'large' | 'cavernous';
  glutenWallAppearance: 'thick_opaque' | 'moderate' | 'thin_translucent' | 'torn_ragged';
  densePatchPresence: boolean;
  gummyTexture: boolean;
  tunneling: boolean;
}

export interface ExteriorFeatures {
  ovenSpring: 'none' | 'minimal' | 'moderate' | 'dramatic' | 'bursting';
  earPresence: boolean;
  crustColor: 'pale' | 'golden' | 'deep_brown' | 'dark';
  spreadRatio: 'tall' | 'moderate' | 'flat' | 'pancake';
  scoringBehavior: 'clean_open' | 'collapsed' | 'burst_random' | 'dragged';
  surfaceBlistering: boolean;
}

// ─── Training Exemplars ────────────────────────────────────────────────
// Each exemplar represents a consensus-documented pattern.

export interface TrainingExemplar {
  label: Diagnosis;
  fermentationState: FermentationState;
  crumb: CrumbFeatures;
  exterior: ExteriorFeatures;
  description: string;
  advice: string;
  sources: string[];
}

export const TRAINING_DATA: TrainingExemplar[] = [
  // ── UNDER-FERMENTED (classic) ────────────────────────────────────
  {
    label: 'under_fermented',
    fermentationState: 'under_fermented',
    crumb: {
      holeDistribution: 'bottom_dense',
      holeSizeVariance: 'high',
      dominantHoleSize: 'micro',
      glutenWallAppearance: 'thick_opaque',
      densePatchPresence: true,
      gummyTexture: true,
      tunneling: true,
    },
    exterior: {
      ovenSpring: 'dramatic',
      earPresence: false,
      crustColor: 'pale',
      spreadRatio: 'tall',
      scoringBehavior: 'burst_random',
      surfaceBlistering: false,
    },
    description:
      'Dense, heavy loaf with tight crumb throughout. May have a few large tunnels near the top crust surrounded by gummy, wet-feeling dough. Bottom inch is practically solid. Loaf feels heavy for its size. Crust is pale because fermentation did not produce enough sugars for Maillard reaction.',
    advice: 'Extend your bulk fermentation by 30–60 minutes, or raise ambient temperature by 2–3°C.',
    sources: [
      'The Sourdough Journey — How to Read a Sourdough Crumb',
      'Trevor Jay Wilson — Underfermentation Instagram Recap #6',
      'The Bread Code — Debugging Your Crumb',
      'The Perfect Loaf — Ultimate Guide to Bulk Fermentation',
    ],
  },

  // ── FOOL'S CRUMB (underfermented variant) ────────────────────────
  {
    label: 'fools_crumb',
    fermentationState: 'under_fermented',
    crumb: {
      holeDistribution: 'top_heavy',
      holeSizeVariance: 'high',
      dominantHoleSize: 'cavernous',
      glutenWallAppearance: 'thick_opaque',
      densePatchPresence: true,
      gummyTexture: true,
      tunneling: true,
    },
    exterior: {
      ovenSpring: 'dramatic',
      earPresence: true,
      crustColor: 'golden',
      spreadRatio: 'tall',
      scoringBehavior: 'burst_random',
      surfaceBlistering: false,
    },
    description:
      "Large cavernous holes near the top that look impressive, but surrounded by dense, gummy dough. The \"fool's crumb\" fools you into thinking the bread is airy — it is actually dense and heavy. The big holes are tunnels where gas rushed upward because gluten wasn't developed enough to trap it evenly. Ignore the biggest hole and examine the smallest ones: jagged, torn small holes confirm underfermentation.",
    advice:
      "Don't be fooled by the big holes — your bulk was too short. Add 30–45 minutes to bulk, and consider one extra fold early on to build structure.",
    sources: [
      "Sourdough Archive — Sourdough Crumb Guide: Open vs Dense vs Fool's Crumb",
      'The Fresh Loaf — Open Crumb Fraudery',
      'Trevor Jay Wilson — Open Crumb Mastery',
      'Homemade Food Junkie — How to Read Sourdough Crumb Structure',
    ],
  },

  // ── SLIGHTLY UNDER ───────────────────────────────────────────────
  {
    label: 'slightly_under',
    fermentationState: 'slightly_under',
    crumb: {
      holeDistribution: 'top_heavy',
      holeSizeVariance: 'medium',
      dominantHoleSize: 'small',
      glutenWallAppearance: 'thick_opaque',
      densePatchPresence: true,
      gummyTexture: false,
      tunneling: false,
    },
    exterior: {
      ovenSpring: 'dramatic',
      earPresence: true,
      crustColor: 'golden',
      spreadRatio: 'tall',
      scoringBehavior: 'burst_random',
      surfaceBlistering: false,
    },
    description:
      'Loaf rises tall — often triangular or pyramidal in profile — but crumb is uneven. Larger holes cluster toward the top, tighter crumb toward the bottom. Not gummy, but denser than ideal. Oven spring is exaggerated, often bursting open outside the score lines. Poke test rebounds immediately.',
    advice: 'You are close. Add 15–20 minutes to your bulk, or let the final proof go a bit longer.',
    sources: [
      'Challenger Breadware — Identifying Proofing Levels in Baked Bread',
      'The Perfect Loaf — Ultimate Guide to Proofing Bread Dough',
      'Sourdough Talk — Underproofed Sourdough Bread',
    ],
  },

  // ── PROPERLY FERMENTED (white flour) ─────────────────────────────
  {
    label: 'properly_fermented',
    fermentationState: 'properly_fermented',
    crumb: {
      holeDistribution: 'even',
      holeSizeVariance: 'medium',
      dominantHoleSize: 'medium',
      glutenWallAppearance: 'thin_translucent',
      densePatchPresence: false,
      gummyTexture: false,
      tunneling: false,
    },
    exterior: {
      ovenSpring: 'moderate',
      earPresence: true,
      crustColor: 'deep_brown',
      spreadRatio: 'tall',
      scoringBehavior: 'clean_open',
      surfaceBlistering: true,
    },
    description:
      'Even distribution of varied-size holes from bottom to top crust. Gluten walls are thin and translucent — lacy, almost custardy. No dense patches, no gumminess. Irregular mix of large, medium, and small bubbles looks organic. Crust is deep brown with blisters. Good oven spring with a defined ear at the score. Loaf feels light for its size.',
    advice: 'Nailed it. Log this bake as your reference — same bulk time, same temperature, same folds.',
    sources: [
      'The Perfect Loaf — How to Bake Open Crumb Sourdough Bread',
      'Trevor Jay Wilson — Open Crumb Mastery',
      'Pump Street Chocolate — Sourdough Crumb Chart',
      'The Sourdough Journey — How to Read a Sourdough Crumb',
    ],
  },

  // ── PROPERLY FERMENTED (whole wheat — tight crumb is normal) ─────
  {
    label: 'properly_fermented',
    fermentationState: 'properly_fermented',
    crumb: {
      holeDistribution: 'even',
      holeSizeVariance: 'low',
      dominantHoleSize: 'small',
      glutenWallAppearance: 'moderate',
      densePatchPresence: false,
      gummyTexture: false,
      tunneling: false,
    },
    exterior: {
      ovenSpring: 'moderate',
      earPresence: true,
      crustColor: 'deep_brown',
      spreadRatio: 'moderate',
      scoringBehavior: 'clean_open',
      surfaceBlistering: false,
    },
    description:
      'Tight, even crumb with small uniform holes — this is NORMAL for whole wheat or rye. Bran particles physically cut gluten strands, preventing large open holes. Crumb should feel moist but not gummy, and holes should be round and shiny (healthy fermentation) even though they are small. Loaf has moderate spring and a defined ear.',
    advice:
      'This looks right for whole grain flour. Tight crumb is expected — bran cuts gluten strands. Focus on even hole distribution, not hole size.',
    sources: [
      'The Bread Code — Debugging Your Crumb',
      'Simply Bread — How to Read Your Crumb Like a Seasoned Baker',
      'Fond Kitchen — Crumb Structure: Open vs Tight Explained',
      'The Pantry Mama — What Should Sourdough Bread Actually Look Like',
    ],
  },

  // ── SLIGHTLY OVER ────────────────────────────────────────────────
  {
    label: 'slightly_over',
    fermentationState: 'slightly_over',
    crumb: {
      holeDistribution: 'even',
      holeSizeVariance: 'low',
      dominantHoleSize: 'small',
      glutenWallAppearance: 'torn_ragged',
      densePatchPresence: false,
      gummyTexture: false,
      tunneling: false,
    },
    exterior: {
      ovenSpring: 'minimal',
      earPresence: false,
      crustColor: 'golden',
      spreadRatio: 'moderate',
      scoringBehavior: 'collapsed',
      surfaceBlistering: true,
    },
    description:
      'Crumb looks even but holes are slightly smaller than expected and walls look slack/stretched. Gluten walls have lost tension — they appear torn or ragged at edges. Crust separation may be visible in spots. Oven spring is weak, scoring tends to collapse rather than open. Loaf spreads slightly wider than tall.',
    advice: 'Shorten your bulk by 15–20 minutes, or reduce ambient temperature slightly. You are just past peak.',
    sources: [
      'Pump Street Chocolate — Sourdough Crumb Chart',
      'The Perfect Loaf — How to Bake Sourdough in Summer',
      'Simplicity and a Starter — What Does Overproofed Sourdough Look Like',
    ],
  },

  // ── OVER-FERMENTED ───────────────────────────────────────────────
  {
    label: 'over_fermented',
    fermentationState: 'over_fermented',
    crumb: {
      holeDistribution: 'uniform_tight',
      holeSizeVariance: 'low',
      dominantHoleSize: 'small',
      glutenWallAppearance: 'torn_ragged',
      densePatchPresence: true,
      gummyTexture: true,
      tunneling: false,
    },
    exterior: {
      ovenSpring: 'none',
      earPresence: false,
      crustColor: 'pale',
      spreadRatio: 'pancake',
      scoringBehavior: 'dragged',
      surfaceBlistering: true,
    },
    description:
      'Flat, spreading loaf with no oven spring. Crust is pale because fermentation consumed available sugars. Scoring drags or collapses. Crumb has many small, ragged holes — uniform but dense. Texture is gummy. Gluten has fully relaxed and can no longer trap gas. Dough felt slack and sticky during shaping, spread immediately when turned out of banneton.',
    advice:
      'Your bulk ran too long. Shorten by 30–60 minutes, lower the ambient temperature, or reduce your starter percentage.',
    sources: [
      'The Sourdough Journey — FAQ Over-Proofed or Under-Proofed',
      'Sourdough Archive — How to Fix Overproofed Sourdough',
      "Solo Baking — Overproof vs Underproof: The Baker's Dilemma",
      'Sourdough Talk — Overproofed Sourdough Bread',
    ],
  },

  // ── WEAK SHAPING (not a fermentation problem) ────────────────────
  {
    label: 'weak_shaping',
    fermentationState: 'properly_fermented',
    crumb: {
      holeDistribution: 'even',
      holeSizeVariance: 'medium',
      dominantHoleSize: 'medium',
      glutenWallAppearance: 'moderate',
      densePatchPresence: false,
      gummyTexture: false,
      tunneling: false,
    },
    exterior: {
      ovenSpring: 'minimal',
      earPresence: false,
      crustColor: 'deep_brown',
      spreadRatio: 'flat',
      scoringBehavior: 'collapsed',
      surfaceBlistering: false,
    },
    description:
      'THE KEY DIFFERENTIATOR: Crumb interior looks good — even hole distribution, no gumminess, no dense patches, walls intact. But the loaf is flat and spread out. Crust is properly browned (sugars were NOT consumed, unlike overproofing). The problem is not fermentation — it is surface tension. The dough lacked a taut outer skin to direct oven spring upward. It slumps sideways at the seam rather than sinking uniformly like an overproofed loaf.',
    advice:
      'Your fermentation was fine — work on shaping. Build more surface tension during pre-shape and final shape. Let the dough rest 15–20 min between pre-shape and final shape.',
    sources: [
      'The Fresh Loaf — Over-proofing, under-proofing or just bad shaping',
      'Homemade Food Junkie — How to Shape Sourdough Bread',
      'DreamWhip Bakers — Why Is My Sourdough Flat',
      'Sourdough Rise — Sourdough Spreading Flat Instead of Rising Up',
      'The Fresh Loaf — Good proofing but flat sourdough',
      'The Fresh Loaf — Surface tension issues',
    ],
  },
];

// ─── Fusion Rules ──────────────────────────────────────────────────────

export interface FusionInput {
  crumbClassProbabilities: Record<FermentationState, number>;
  exteriorShapeClass: 'tall' | 'moderate' | 'flat' | 'pancake';
  bulkDurationMinutes: number;
  foldCount: number;
  userAverageBulkMinutes: number | null;
  crustColor: 'pale' | 'golden' | 'deep_brown' | 'dark';
}

export interface FusionOutput {
  diagnosis: Diagnosis;
  confidence: number;
  advice: string;
  reasoning: string;
}

export const FLAT_LOAF_DISAMBIGUATION = {
  description: `
    When the exterior classifier detects a flat/spreading loaf, the image alone
    cannot reliably distinguish overproofing from weak shaping. The fusion layer
    uses these signals:

    1. BULK DURATION vs USER BASELINE
       - If bulkDuration > userAverage * 1.25 → lean overproofed
       - If bulkDuration ≈ userAverage (±15%) → lean weak shaping
       - If bulkDuration < userAverage * 0.85 → lean underfermented-slack

    2. CRUST COLOR
       - Pale crust + flat → overproofed (sugars consumed by extended fermentation)
       - Deep brown crust + flat → weak shaping (sugars intact, Maillard normal)

    3. CRUMB INTERIOR
       - Gummy + ragged walls + flat → overproofed
       - Even holes + intact walls + flat → weak shaping

    CONFIDENCE THRESHOLDS:
    - All three signals agree → high confidence (>0.85)
    - Two agree, one ambiguous → moderate confidence (0.6–0.85)
    - Signals conflict → low confidence (<0.6)
  `,
  rules: [
    {
      condition: 'flat + pale_crust + gummy_crumb + long_bulk',
      diagnosis: 'over_fermented' as Diagnosis,
      confidence: 0.92,
      reasoning: 'Flat shape, pale crust (sugars consumed), gummy interior, and extended bulk time all point to overfermentation.',
    },
    {
      condition: 'flat + brown_crust + even_crumb + normal_bulk',
      diagnosis: 'weak_shaping' as Diagnosis,
      confidence: 0.88,
      reasoning: 'The crumb looks well-fermented and crust browned normally — the flat shape is from insufficient surface tension during shaping, not fermentation.',
    },
    {
      condition: 'flat + pale_crust + dense_crumb + short_bulk',
      diagnosis: 'under_fermented' as Diagnosis,
      confidence: 0.85,
      reasoning: 'Short bulk + dense crumb + flat shape = the dough never developed enough gas or structure. Extend bulk significantly.',
    },
    {
      condition: 'flat + brown_crust + gummy_crumb + long_bulk',
      diagnosis: 'over_fermented' as Diagnosis,
      confidence: 0.75,
      reasoning: 'Gummy crumb and long bulk suggest overfermentation despite decent browning.',
    },
    {
      condition: 'flat + golden_crust + even_crumb + normal_bulk',
      diagnosis: 'weak_shaping' as Diagnosis,
      confidence: 0.70,
      reasoning: 'Crumb and timing look fine. The spread is likely from shaping.',
    },
  ],
};

export const FLOUR_TYPE_ADJUSTMENTS = {
  description: `
    Whole wheat and rye flours naturally produce tighter crumbs because bran
    particles physically cut gluten strands. A tight crumb from 100% whole wheat
    is NOT underfermented — it is structurally normal.

    Weight hole DISTRIBUTION more than hole SIZE for whole grain.
    Whole grain flours also have more protease enzymes — overfermentation
    window is shorter.
  `,
  adjustments: [
    { flourTag: 'white', crumbSizeShift: 0, overfermentWindow: 1.0 },
    { flourTag: 'partial_whole_grain', crumbSizeShift: -1, overfermentWindow: 0.85 },
    { flourTag: 'whole_wheat', crumbSizeShift: -2, overfermentWindow: 0.7 },
    { flourTag: 'rye', crumbSizeShift: -2, overfermentWindow: 0.6 },
  ],
};

export const HYDRATION_NOTES = {
  description: `
    Higher hydration (75%+) naturally produces more open crumb.
    Open crumb is achievable at ANY hydration — it is primarily fermentation
    and handling, not water content.
    High hydration doughs are more prone to spreading — weight crumb interior
    and crust color MORE, shape LESS when user indicates high hydration.
  `,
};

export const DIAGNOSIS_COPY: Record<Diagnosis, { title: string; emoji: string; oneLiner: string; expandedWhy: string }> = {
  under_fermented: {
    title: 'Under-fermented',
    emoji: '⏱️',
    oneLiner: 'Extend bulk by 30–60 min, or raise ambient temp by 2–3°C.',
    expandedWhy:
      "Your yeast hadn't produced enough CO₂ to inflate the crumb evenly. The dense base and tunneling near the top are gas rushing upward through undeveloped gluten. The pale crust means not enough sugars were freed by fermentation for browning.",
  },
  slightly_under: {
    title: 'Almost there',
    emoji: '🔜',
    oneLiner: 'Add 15–20 min to bulk, or extend final proof slightly.',
    expandedWhy:
      "Fermentation was close but not quite at peak. The uneven hole distribution (larger on top, tighter on bottom) shows gas wasn't fully distributed.",
  },
  properly_fermented: {
    title: 'Well fermented',
    emoji: '✅',
    oneLiner: 'Nailed it. Save this as your reference bake.',
    expandedWhy:
      'Even hole distribution, translucent gluten walls, good crust color — this dough hit peak fermentation.',
  },
  slightly_over: {
    title: 'Slightly over',
    emoji: '⚡',
    oneLiner: 'Shorten bulk by 15–20 min next time, or lower the temperature.',
    expandedWhy:
      'The dough went just past peak. Gluten walls are starting to thin and tear, and the structure is losing tension.',
  },
  over_fermented: {
    title: 'Over-fermented',
    emoji: '🫠',
    oneLiner: 'Shorten bulk by 30–60 min, lower temp, or reduce starter %.',
    expandedWhy:
      "Extended fermentation consumed available sugars (hence the pale crust) and degraded the gluten network. The gummy texture comes from enzymatic breakdown of starches.",
  },
  weak_shaping: {
    title: 'Shaping issue',
    emoji: '🤲',
    oneLiner: 'Your fermentation was fine — work on building surface tension.',
    expandedWhy:
      "The crumb interior looks healthy, and the crust browned well — this isn't a fermentation problem. The flat shape comes from insufficient surface tension during final shaping.",
  },
  fools_crumb: {
    title: "Fool's crumb",
    emoji: '🃏',
    oneLiner: "Don't be fooled by the big holes — bulk was too short. Add 30–45 min.",
    expandedWhy:
      "Those impressive caverns are gas that rushed to the top because the gluten wasn't developed enough to trap it evenly. Look past the biggest holes — the small ones are jagged and the base is dense and gummy.",
  },
};
