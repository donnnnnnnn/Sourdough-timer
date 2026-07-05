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
  | 'fools_crumb'
  | 'oven_artifact';

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
  // Shoulder profile — side silhouette of the loaf, a key early-signal dimension.
  // high_even = "bunny profile" (properly proofed)
  // pyramidal  = peaked/triangular top (slightly under)
  // falling    = sides drooping from ear (slightly over)
  // sunken     = sides collapsed (significantly over)
  // flat       = no profile distinction (severely over or under)
  shoulderProfile?: 'high_even' | 'pyramidal' | 'falling' | 'sunken' | 'flat';
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

  // ── BUNNY PROFILE — properly proofed exterior shape signal ──────
  // Explicit exemplar for the "bunny profile" silhouette so the classifier
  // learns to read shoulder geometry as a fermentation signal, not just crumb.
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
      shoulderProfile: 'high_even',
    },
    description:
      'The "bunny profile" — viewed from the side, both shoulders of the loaf rise high and evenly away from the score ear, resembling rabbit ears. This symmetric, high-shoulder silhouette means the dough had enough gas and structure to expand uniformly upward on all sides, not just at the score. Gluten strands are visible stretched across the bloom (the open score line). Crumb: consistent distribution of small, medium, and large holes from bottom to top and edge to edge. No dense strip at base. Crust is multi-toned brown. This is the gold-standard exterior shape for a properly proofed boule or batard.',
    advice: 'Perfect bake. The bunny profile confirms even fermentation and good structure. Log this bulk time and temperature as your target baseline.',
    sources: [
      'The Sourdough Journey — How to Read a Sourdough Crumb (PDF)',
      'Simply Bread — How to Read Your Crumb Like a Seasoned Baker',
    ],
  },

  // ── PYRAMIDAL SHAPE — slightly under exterior signal ─────────────
  // Tall but peaked/triangular profile rather than even high shoulders.
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
      tunneling: true,
    },
    exterior: {
      ovenSpring: 'dramatic',
      earPresence: true,
      crustColor: 'golden',
      spreadRatio: 'tall',
      scoringBehavior: 'burst_random',
      surfaceBlistering: false,
      shoulderProfile: 'pyramidal',
    },
    description:
      'Pyramidal (triangular) profile when viewed from the side — the loaf peaks in a sharp point from the score ear rather than rising with rounded, even shoulders. Excess unreleased yeast energy drove a powerful vertical spring from the score, but insufficient internal gas distribution meant the rest of the loaf could not expand to match. A "belly" or bulge is often visible just below the bloom. Tall ear is present and may look dramatic, but this is a paradox: a tall ear here signals excess unreleased energy, NOT good fermentation. Crumb confirms it — dense strip at the bottom half, large holes or tunnels near the top. Crust is more blonde than brown (fermentation did not free enough sugars).',
    advice:
      'The pyramidal profile is a reliable sign you are slightly short on bulk. Add 15–30 minutes. The dramatic ear is misleading — always check the crumb bottom strip.',
    sources: [
      'The Sourdough Journey — How to Read a Sourdough Crumb (PDF)',
      'Pump Street Chocolate — Sourdough Crumb Chart (Hours 2–3)',
      'Pantry Mama — Underfermented Sourdough',
    ],
  },

  // ── FALLING SHOULDERS — slightly over exterior signal ────────────
  // Distinct from a fully flat/pancake loaf. Shoulders droop; some height remains.
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
      surfaceBlistering: false,
      shoulderProfile: 'falling',
    },
    description:
      '"Falling shoulders" is the earliest reliable exterior sign of overproofing. The sides of the loaf droop downward from where the score ear would be, rather than standing high and even. Unlike a fully overproofed loaf (spreadRatio: pancake, no height at all), falling-shoulders loaves still have noticeable height — they have not gone fully flat yet. The score may have partially opened but the area around it sags rather than lifts. A gap between the top crust and crumb (crust separation) may be beginning to appear. Crumb shows small, evenly distributed holes that look almost right inside, but gluten walls are stretched and have ragged edges — the structure is losing tension. This is the slightly_over state: still edible bread, but fermentation has just passed peak.',
    advice:
      'Falling shoulders with a still-reasonable crumb means you are just past peak. Shorten bulk by 15–20 minutes or reduce ambient temperature by 2°C next time.',
    sources: [
      'The Sourdough Journey — How to Read a Sourdough Crumb (PDF)',
      'Simply Bread — How to Read Your Crumb Like a Seasoned Baker',
      'Challenger Breadware — Identifying Proofing Levels in Baked Bread',
    ],
  },

  // ── MEGA POCKETS NEAR CRUST — oven artifact, not fermentation ────
  // Large merged alveoli just under the crust/score; interior crumb is fine.
  {
    label: 'oven_artifact',
    fermentationState: 'properly_fermented',
    crumb: {
      holeDistribution: 'top_heavy',
      holeSizeVariance: 'high',
      dominantHoleSize: 'cavernous',
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
      shoulderProfile: 'high_even',
    },
    description:
      '"Mega pockets" — very large merged alveoli clustered just under the top crust or directly below the scored surface, while the lower crumb interior looks normally distributed and healthy. THIS IS NOT A FERMENTATION PROBLEM. When the oven temperature is too high (above ~230°C/446°F) or insufficient steam is applied, the crust sets and seals too rapidly. Expanding gas cannot push through the sealed crust and instead pools in large merged cavities just beneath it. Key distinguishers from fermentation problems: (1) the loaf has good height and a proper ear (fermentation was fine); (2) crust color is deep brown (sugars were not prematurely consumed); (3) the lower crumb is properly open with thin, translucent walls — not gummy; (4) mega pockets have smooth, round-ish walls, unlike the jagged torn walls of overproofing or the gummy opaque walls of underproofing.',
    advice:
      'Do not adjust your bulk time — this is an oven problem. Lower your initial bake temperature by 10–15°C, or ensure the lid is on firmly for the entire first 20 minutes to maintain adequate steam.',
    sources: [
      'The Bread Code — Debugging Your Crumb',
      'The Sourdough Journey — FAQ Over/Under Proofed',
    ],
  },

  // ── FALSELY OPEN OVERPROOFED — Challenger Breadware paradox ──────
  // Interior appears "open" with large holes, but this is structural collapse.
  {
    label: 'over_fermented',
    fermentationState: 'over_fermented',
    crumb: {
      holeDistribution: 'uniform_open',
      holeSizeVariance: 'high',
      dominantHoleSize: 'large',
      glutenWallAppearance: 'torn_ragged',
      densePatchPresence: false,
      gummyTexture: true,
      tunneling: false,
    },
    exterior: {
      ovenSpring: 'none',
      earPresence: false,
      crustColor: 'pale',
      spreadRatio: 'pancake',
      scoringBehavior: 'dragged',
      surfaceBlistering: false,
      shoulderProfile: 'flat',
    },
    description:
      'The "falsely open" overproofed crumb — a trap for beginners. The interior shows large, seemingly open holes that may look impressive at first glance. This is structural failure masquerading as open crumb. The holes formed because the gluten network degraded past the point of holding gas uniformly; CO₂ collected in irregular collapsed pockets rather than well-formed alveoli. Five key distinguishers from true open crumb: (1) the loaf is flat/pancake — true open crumb loaves have good height; (2) crust is pale, not brown — fermentation consumed all available sugars; (3) crumb walls are torn and ragged, not thin and translucent; (4) the texture is gummy despite the apparent openness; (5) there is no ear and the score dragged rather than opening. These "holes" are collapse artifacts, not healthy alveoli.',
    advice:
      'Do not be fooled by the apparent openness. Flat + pale + gummy = overfermented. Shorten bulk by 30–60 minutes, lower ambient temperature, or reduce starter percentage.',
    sources: [
      'Challenger Breadware — Identifying Proofing Levels in Baked Bread',
      'The Bread Code — Debugging Your Crumb',
      'The Perfect Loaf — How to Bake Open Crumb Sourdough Bread',
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

    4. SHOULDER PROFILE (exterior silhouette — read BEFORE slicing)
       - high_even ("bunny profile") → properly_fermented
       - pyramidal (peaked/triangular top) → slightly_under
         * NOTE: pyramidal loaves often have a dramatic tall ear — do NOT
           interpret the tall ear as a positive signal here. Check the
           crumb bottom strip for the confirming dense band.
       - falling (sides drooping from ear, moderate height) → slightly_over
         * DISTINCT from flat/pancake. Falling-shoulders loaves still have
           height. The droop is the first sign of structural decline.
       - sunken (sides collapsed, some height remaining) → over_fermented
       - flat (no profile, pancake) → over_fermented OR under_fermented
         (use crust color + crumb interior to break tie)

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
    // ── Shoulder-profile rules (Source: Sourdough Journey PDF + Simply Bread) ──
    {
      condition: 'shoulder_falling + moderate_spread + ragged_walls + normal_to_long_bulk',
      diagnosis: 'slightly_over' as Diagnosis,
      confidence: 0.87,
      reasoning:
        'Falling shoulders are the earliest reliable exterior sign of overproofing. The loaf has not gone fully flat (still has height), but the sides are drooping rather than standing. This is distinct from a fully collapsed loaf — use slightly_over, not over_fermented.',
    },
    {
      condition: 'shoulder_falling + moderate_spread + even_intact_walls',
      diagnosis: 'slightly_over' as Diagnosis,
      confidence: 0.80,
      reasoning:
        'Falling shoulders with still-reasonable crumb interior: fermentation just crossed peak. Crumb looks almost right but structure is starting to lose tension at the walls.',
    },
    {
      condition: 'shoulder_pyramidal + tall_spread + bottom_dense_strip + burst_random',
      diagnosis: 'slightly_under' as Diagnosis,
      confidence: 0.88,
      reasoning:
        'A pyramidal/triangular loaf profile with a dense crumb bottom strip is a reliable sign of slight underproofing. Excess unreleased energy drove a strong vertical spring from the score without even expansion across the loaf. The tall ear here is a deceptive signal — it reflects unreleased energy, not good fermentation.',
    },
    {
      condition: 'shoulder_pyramidal + tall_spread + cavernous_top_holes + dense_bottom',
      diagnosis: 'fools_crumb' as Diagnosis,
      confidence: 0.85,
      reasoning:
        "Pyramidal shape combined with large cavernous holes at top and a dense bottom strip is the classic fool's crumb exterior+interior pattern. The caverns are gas that rushed upward through undeveloped gluten.",
    },
    {
      condition: 'shoulder_high_even + tall_spread + gluten_strands_in_bloom',
      diagnosis: 'properly_fermented' as Diagnosis,
      confidence: 0.90,
      reasoning:
        'Bunny profile (high even shoulders) combined with gluten strands visible across the bloom is the highest-confidence exterior read for proper fermentation. Confirm with crumb interior.',
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

// ─── Oven Artifacts ────────────────────────────────────────────────────────
// Crumb patterns caused by oven conditions, not fermentation.
// Misdiagnosing these as fermentation problems leads to incorrect bulk
// time adjustments that worsen results.
//
// PRINCIPLE: Oven artifacts appear alongside otherwise good exterior signals
// (proper height, brown crust, decent ear). If the loaf looks well-proofed
// from the outside but the crumb shows one of these patterns, suspect the
// oven before adjusting bulk.

export const OVEN_ARTIFACTS = {
  description: `
    Some crumb patterns are caused by oven conditions, not fermentation level.
    These must NOT be diagnosed as under/over-fermented.

    Shared tell: the loaf exterior is good (height, brown crust, ear) but
    the crumb shows a localized or anomalous pattern inconsistent with the
    exterior's fermentation read.
  `,
  patterns: [
    {
      name: 'mega_pockets',
      aliases: ['converged alveoli', 'sub-crust caverns'],
      trigger: 'Oven too hot (above ~230°C / 446°F) OR insufficient steam (lid off too early)',
      visual:
        'Very large merged alveoli clustered just under the top crust or scored surface. ' +
        'Lower interior crumb is normally distributed with thin translucent walls. ' +
        'Holes are large but smooth-walled, not jagged. Loaf height and crust color are good.',
      mechanism:
        'Crust sets and seals too rapidly. Expanding gas cannot escape through the sealed ' +
        'surface and instead pools in merged cavities just beneath it.',
      distinguishFrom: {
        fools_crumb:
          "Mega-pocket walls are thin and translucent (healthy gluten). Fool's crumb holes are surrounded by dense, gummy, opaque crumb.",
        properly_fermented:
          'Mega pockets are localized at the top. True open crumb is distributed edge-to-edge and top-to-bottom.',
        under_fermented:
          'Under-fermented crumb is heavy and pale. Mega-pocket loaves have good height and deep brown crust.',
      },
      fix: 'Lower initial bake temperature by 10–15°C. Ensure lid or steam cover is tightly sealed for the full first 20 minutes.',
    },
    {
      name: 'crust_sealing_band',
      aliases: ['dense perimeter ring', 'steam-starved crumb'],
      trigger: 'Insufficient steam — crust seals before dough finishes expanding',
      visual:
        'Dense, compressed crumb ring just inside the crust, all the way around the loaf. ' +
        'Center crumb may be open and well-developed. Score tore sideways instead of lifting cleanly. ' +
        'Loaf height is normal.',
      mechanism:
        'Without steam, the outer skin dries and hardens early, creating a rigid shell that ' +
        'resists expansion. The trapped dough compresses against the shell instead of opening.',
      distinguishFrom: {
        over_fermented:
          'Steam-starved crumb has a dense outer ring but normal loaf height. Overproofed crumb is dense throughout and the loaf is flat.',
        slightly_under:
          'Underproofed dense strip is at the BOTTOM of the slice. Steam-starved dense ring is around the PERIMETER.',
      },
      fix: 'Bake covered (Dutch oven, combo cooker) for first 20 min. If baking open, place a water-filled pan on the oven floor.',
    },
    {
      name: 'underbaked_gummy',
      aliases: ['wet crumb', 'gummy interior despite good rise'],
      trigger: 'Oven spring complete but insufficient bake time or temperature',
      visual:
        'Crumb looks open and well-fermented. Holes are round and appropriate. ' +
        'But crumb feels wet and gummy when cut — knife picks up doughy residue even after full cool-down. ' +
        'Loaf has good height and brown crust.',
      mechanism:
        'Starch gelatinization requires sustained heat. If the interior did not reach ' +
        '96–99°C / 205–210°F, starch remains partially raw regardless of crumb structure.',
      distinguishFrom: {
        under_fermented:
          'Underfermented gummy crumb has a dense bottom strip, pale crust, and poor oven spring. Underbaked gummy crumb has a well-developed open structure and brown crust.',
        over_fermented:
          'Overfermented gummy crumb comes with a flat, pale, pancake-shaped loaf. Underbaked gummy crumb comes with a properly risen, well-colored loaf.',
      },
      fix: 'Extend bake time by 5–10 minutes. Target internal temperature of 96–99°C / 205–210°F. Let cool fully on a wire rack before cutting (residual heat continues cooking).',
    },
  ],
};

export const DIAGNOSIS_COPY: Record<Diagnosis, { title: string; emoji: string; oneLiner: string; expandedWhy: string }> = {
  under_fermented: {
    title: 'Under-fermented',
    emoji: '⏱️',
    oneLiner: 'Extend bulk by 30–60 min, or raise ambient temp by 2–3°C.',
    expandedWhy:
      "Your yeast hadn't produced enough CO₂ to inflate the crumb evenly. The dense base strip and tunneling near the top are gas rushing upward through undeveloped gluten — insufficient gas accumulation means insufficient structure (the \"bricks\" analogy: no bricks, the mortar alone can't hold the wall). The pale crust means not enough sugars were freed by fermentation for the Maillard reaction. Loaf feels heavy for its size. Gummy knife test: knife picks up doughy residue on the blade.",
  },
  slightly_under: {
    title: 'Almost there',
    emoji: '🔜',
    oneLiner: 'Add 15–20 min to bulk, or extend final proof slightly.',
    expandedWhy:
      "Fermentation was close but not quite at peak. The uneven hole distribution (larger on top, tighter on bottom with a dense strip at the base) shows gas wasn't fully distributed through the dough. Look for the loaf's shoulder profile: a pyramidal or triangular silhouette (peaking sharply at the score) is a key exterior tell for slight underproofing. The dramatic ear here is a paradox — it signals excess unreleased energy, not good fermentation. Add bulk time each bake until you find where the loaf just starts to overproof, then back off slightly.",
  },
  properly_fermented: {
    title: 'Well fermented',
    emoji: '✅',
    oneLiner: 'Nailed it. Save this as your reference bake.',
    expandedWhy:
      'Even hole distribution from bottom crust to top crust and edge to edge, translucent gluten walls, multi-toned brown crust — this dough hit peak fermentation. Exterior tells: the "bunny profile" (high, even shoulders on both sides of the score), gluten strands visible stretched across the open bloom (not bubbles — strands). Crumb releases cleanly from a knife. Loaf feels light for its size.',
  },
  slightly_over: {
    title: 'Slightly over',
    emoji: '⚡',
    oneLiner: 'Shorten bulk by 15–20 min next time, or lower the temperature.',
    expandedWhy:
      'The dough went just past peak. Gluten walls are starting to thin and tear (ragged-edged holes instead of clean round ones), and the structure is losing tension. Key exterior tell: "falling shoulders" — the sides of the loaf droop downward from the ear rather than standing high and even. This is distinct from a flat pancake loaf — falling-shoulders loaves still have height. You may also see crust separation (a gap forming between top crust and crumb) and fewer gluten strands in the bloom, replaced by bubbles.',
  },
  over_fermented: {
    title: 'Over-fermented',
    emoji: '🫠',
    oneLiner: 'Shorten bulk by 30–60 min, lower temp, or reduce starter %.',
    expandedWhy:
      "Extended fermentation consumed available sugars (hence the pale or mottled crust — no sugars left for browning) and degraded the gluten network. The gummy texture comes from enzymatic breakdown of starches. Note: the crumb may paradoxically appear \"open\" with large holes — this is structural collapse, not true open crumb. True open crumb loaves are tall with brown crusts; over-fermented loaves are flat and pale. Ragged-edged holes, no ear, dragged scoring, and gummy texture together confirm over-fermentation despite any apparent openness.",
  },
  weak_shaping: {
    title: 'Shaping issue',
    emoji: '🤲',
    oneLiner: 'Your fermentation was fine — work on building surface tension.',
    expandedWhy:
      "The crumb interior looks healthy (even holes, intact walls, no gumminess), and the crust browned well — this isn't a fermentation problem. The flat shape comes from insufficient surface tension during final shaping. Unlike overproofing where the whole loaf sinks uniformly, weak-shaping loaves tend to slump sideways at the seam. Crust color is the key differentiator: brown crust + flat = shaping; pale crust + flat = fermentation.",
  },
  fools_crumb: {
    title: "Fool's crumb",
    emoji: '🃏',
    oneLiner: "Don't be fooled by the big holes — bulk was too short. Add 30–45 min.",
    expandedWhy:
      "Those impressive caverns near the top are gas that rushed upward because the gluten wasn't developed enough to trap it evenly throughout the loaf. The dense, gummy bottom strip is the tell — look past the biggest holes and examine the base and the small holes: jagged, torn edges and thick opaque walls confirm underfermentation. Exterior tell: pyramidal loaf shape with a dramatic ear (excess unreleased energy, NOT a positive signal). Airiness ≠ openness — true open crumb requires both overall lightness AND well-distributed holes. This loaf is heavy and dense despite the few large voids.",
  },
  oven_artifact: {
    title: 'Oven condition issue',
    emoji: '🔥',
    oneLiner: 'This pattern is from oven temp or steam — not fermentation. Adjust your bake environment.',
    expandedWhy:
      "The mega pockets or crust compression here are caused by the oven, not how long you bulk fermented. When the temperature is too high (above ~230°C / 446°F) or steam is insufficient, the crust seals too fast and expanding gas pools in large merged cavities just below the surface — \"mega pockets.\" Your fermentation was likely fine: the loaf has good height, a brown crust, and a proper ear. The lower crumb is normally developed with thin translucent walls. Do not adjust bulk time. Lower oven temp by 10–15°C, or ensure your lid is tight for the full first 20 minutes.",
  },
};

// ─── Crumb Vocabulary Reference ───────────────────────────────────────────
// Shape and morphology terms used in training data descriptions and UI copy.
// Sourced from: The Sourdough Journey (Cucuzza), Simply Bread, Challenger
// Breadware, The Bread Code (Kleinwächter), Trevor J. Wilson.

export const CRUMB_VOCABULARY = {
  // Exterior shape terms
  bunny_profile:
    'Loaf silhouette with tall, high, even shoulders on both sides of the score ear — the gold-standard exterior shape for a properly proofed loaf. (Source: The Sourdough Journey)',
  pyramidal_shape:
    'Loaf that peaks sharply at the score in a triangular/pointed profile rather than having rounded shoulders. Key sign of slight underproofing. Often accompanied by a dramatic ear (which is a deceptive signal here, not a positive one). (Sources: Sourdough Journey, Pump Street Crumb Chart)',
  belly:
    "A bulge that appears just below the bloom (score opening) on a slightly underproofed loaf, caused by gas pressure behind the sealed crust. (Source: The Sourdough Journey)",
  falling_shoulders:
    'Sides of the loaf that droop downward from the score ear rather than standing high and even. The earliest reliable exterior sign of overproofing — distinct from a flat/pancake loaf (which has no height at all). (Sources: Simply Bread, Sourdough Journey)',
  sunken_shoulders:
    'Sides that have fully collapsed inward. More severe than falling shoulders — indicates significant overproofing. (Source: Simply Bread)',
  gluten_strands_in_bloom:
    'Fine, thread-like strands of gluten visible stretched across the open score line. Sign of properly proofed dough with good structure. Replaced by bubbles as overproofing progresses. (Sources: Sourdough Journey, The Perfect Loaf)',
  bubbles_in_bloom:
    'Gas pockets visible in the open score line, replacing gluten strands. Sign of overproofing — the gluten is too weak to form strands. (Source: The Sourdough Journey)',
  // Interior crumb terms
  alveoli:
    'Individual gas pockets (holes) in the crumb. Size, shape, and distribution are the primary classifier signals.',
  dense_strip_at_bottom:
    'A band of tight, compact crumb running along the bottom of a slice — hallmark of an underproofed loaf regardless of what the top half looks like. (Source: The Sourdough Journey)',
  tunneling:
    'A large elongated hole running horizontally, often near the top crust, in otherwise dense underproofed crumb. Gas rushed upward through undeveloped gluten.',
  mega_pockets:
    'Very large merged alveoli clustered just under the top crust or scored surface. Caused by excessive oven heat or insufficient steam — NOT a fermentation issue. Walls are thin and translucent (healthy). (Source: The Bread Code)',
  ragged_edged_holes:
    'Holes with irregular, torn-looking edges rather than smooth round walls. Sign of overproofing or gluten degradation — the walls failed rather than baked cleanly into place. (Source: The Sourdough Journey)',
  lacy:
    'Modifier trait (not a standalone category): every cell inflated to maximum capacity, zero dense spots, glistening/shimmering walls like a snowflake. Most commonly achieved via retarded (overnight refrigerator) proofing. (Source: Wilson — Open Crumb Mastery)',
  glistening:
    'Glossy, shiny appearance on cell walls — sign of high hydration and strong fermentation. Distinct from the dull, flat look of underfermented or overfermented crumb. (Source: Wilson)',
  gummy_knife_test:
    'Practical diagnostic: draw a knife through the crumb — if the blade picks up doughy residue, the bread is either underfermented or underbaked. A properly fermented and baked crumb releases cleanly. (Source: Pantry Mama)',
};
