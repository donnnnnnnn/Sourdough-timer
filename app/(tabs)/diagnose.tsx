import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, Platform, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Camera, ImagePlus, RotateCcw } from 'lucide-react-native';
import { useBakeStore } from '@/store/useBakeStore';
import { diagnose, DIAGNOSIS_COPY, type ClassifierInput, type ShoulderProfile } from '@/model/classifier';
import { analyzeCrumbPhoto } from '@/model/visionAnalyzer';
import type { FermentationState } from '@/model/training-data';

// Which evidence produced the crumb probabilities, surfaced in the result card.
// 'answers' = no photo (or web / analysis failed); the model/heuristic split
// comes from the analyzer's probSource.
type PhotoPath = 'model' | 'heuristic' | 'answers';

const PHOTO_PATH_LABEL: Record<PhotoPath, string> = {
  model: 'Photo analysis: on-device model',
  heuristic: 'Photo analysis: heuristic (beta)',
  answers: 'Answers only — no crumb photo',
};

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
  green: '#4ade80',
  greenSoft: 'rgba(74,222,128,0.12)',
  greenBorder: 'rgba(74,222,128,0.25)',
  red: '#f87171',
  redSoft: 'rgba(248,113,113,0.12)',
  redBorder: 'rgba(248,113,113,0.25)',
  purple: '#c084fc',
  purpleSoft: 'rgba(192,132,252,0.12)',
  purpleBorder: 'rgba(192,132,252,0.3)',
  orange: '#fb923c',
  orangeSoft: 'rgba(251,146,60,0.12)',
  orangeBorder: 'rgba(251,146,60,0.3)',
};

// ── Answer types ───────────────────────────────────────────────────────────

type ShapeAnswer = 'high_even' | 'pyramidal' | 'falling' | 'flat';
type CrumbAnswer = 'even' | 'top_heavy' | 'gummy' | 'mega_pockets';
type CrustAnswer = 'brown_strands' | 'pale_burst' | 'pale_no_ear' | 'brown_no_strands';

// ── Question definitions ───────────────────────────────────────────────────

const SHAPE_OPTIONS: { value: ShapeAnswer; label: string; sub: string }[] = [
  { value: 'high_even',  label: 'Bunny Profile',      sub: 'Tall, high even shoulders' },
  { value: 'pyramidal',  label: 'Pyramidal / Peaked',  sub: 'Triangular top, dramatic ear' },
  { value: 'falling',   label: 'Falling Shoulders',  sub: 'Sides drooping from the ear' },
  { value: 'flat',       label: 'Flat / Pancake',     sub: 'Spread out, little height' },
];

const CRUMB_OPTIONS: { value: CrumbAnswer; label: string; sub: string }[] = [
  { value: 'even',         label: 'Even Throughout',         sub: 'Holes from top to bottom, no dense patches' },
  { value: 'top_heavy',   label: 'Dense Base, Big Top',     sub: 'Tunneling or large holes near top crust' },
  { value: 'gummy',        label: 'Tight & Gummy',           sub: 'Small holes, wet sticky texture' },
  { value: 'mega_pockets', label: 'Large Holes Under Crust', sub: 'Interior looks normal further down' },
];

const CRUST_OPTIONS: { value: CrustAnswer; label: string; sub: string }[] = [
  { value: 'brown_strands',    label: 'Rich Brown + Strands',  sub: 'Gluten threads visible in score' },
  { value: 'pale_burst',       label: 'Pale + Burst Open',     sub: 'Blonde crust, score exploded outward' },
  { value: 'pale_no_ear',      label: 'Pale + No Ear',         sub: 'Pale crust, score dragged or closed' },
  { value: 'brown_no_strands', label: 'Brown + Bubbles',       sub: 'Colored crust, gas pockets at score' },
];

// ── Probability derivation (replaces CNN output) ──────────────────────────
// Maps visual button answers to a rough probability distribution over
// fermentation states. Used as crumbProbs in ClassifierInput.

function deriveCrumbProbs(
  shape: ShapeAnswer,
  crumb: CrumbAnswer,
  crust: CrustAnswer,
): Record<FermentationState, number> {
  const p: Record<FermentationState, number> = {
    under_fermented:   0.15,
    slightly_under:    0.20,
    properly_fermented: 0.30,
    slightly_over:     0.20,
    over_fermented:    0.15,
  };

  if (shape === 'high_even')  { p.properly_fermented += 0.35; p.slightly_over += 0.05; }
  if (shape === 'pyramidal')  { p.slightly_under += 0.25; p.under_fermented += 0.10; }
  if (shape === 'falling')    { p.slightly_over += 0.30; p.over_fermented += 0.05; }
  if (shape === 'flat')       { p.over_fermented += 0.25; p.slightly_over += 0.10; }

  if (crumb === 'even')          { p.properly_fermented += 0.30; }
  if (crumb === 'top_heavy')     { p.slightly_under += 0.25; p.under_fermented += 0.10; }
  if (crumb === 'gummy')         { p.under_fermented += 0.15; p.over_fermented += 0.15; }
  if (crumb === 'mega_pockets')  { p.properly_fermented += 0.35; }

  if (crust === 'brown_strands')    { p.properly_fermented += 0.25; }
  if (crust === 'pale_burst')       { p.slightly_under += 0.20; p.under_fermented += 0.10; }
  if (crust === 'pale_no_ear')      { p.over_fermented += 0.25; p.slightly_over += 0.10; }
  if (crust === 'brown_no_strands') { p.slightly_over += 0.20; p.over_fermented += 0.10; }

  const total = Object.values(p).reduce((a, b) => a + b, 0);
  for (const k in p) p[k as FermentationState] /= total;
  return p;
}

function buildClassifierInput(
  shape: ShapeAnswer,
  crumb: CrumbAnswer,
  crust: CrustAnswer,
  bulkDurationMinutes: number,
  foldCount: number,
  userAverageBulkMinutes: number | null,
): ClassifierInput {
  return {
    crumbProbs: deriveCrumbProbs(shape, crumb, crust),
    shapeFlat: shape === 'flat',
    crustPale: crust === 'pale_burst' || crust === 'pale_no_ear',
    gummyDetected: crumb === 'gummy',
    evenHoles: crumb === 'even',
    tunnelingDetected: crumb === 'top_heavy',
    topHeavyHoles: crumb === 'top_heavy',
    megaPocketsNearCrust: crumb === 'mega_pockets',
    shoulderProfile: shape as ShoulderProfile,
    glutenStrandsInBloom: crust === 'brown_strands',
    bubblesInBloom: crust === 'brown_no_strands',
    bulkDurationMinutes,
    foldCount,
    userAverageBulkMinutes,
  };
}

// ── Diagnosis result colors ────────────────────────────────────────────────

function diagColors(diag: string): { bg: string; border: string; text: string } {
  if (diag === 'properly_fermented')
    return { bg: C.greenSoft, border: C.greenBorder, text: C.green };
  if (diag === 'oven_artifact')
    return { bg: C.orangeSoft, border: C.orangeBorder, text: C.orange };
  if (diag === 'weak_shaping')
    return { bg: C.purpleSoft, border: C.purpleBorder, text: C.purple };
  if (diag === 'over_fermented' || diag === 'slightly_over')
    return { bg: C.redSoft, border: C.redBorder, text: C.red };
  return { bg: C.accentSoft, border: C.accentBorder, text: C.accent };
}

// ── Main screen ────────────────────────────────────────────────────────────

export default function DiagnoseScreen() {
  const { bakeLogs } = useBakeStore();

  const [crumbUri, setCrumbUri] = useState<string | null>(null);
  const [exteriorUri, setExteriorUri] = useState<string | null>(null);
  const [shape, setShape] = useState<ShapeAnswer | null>(null);
  const [crumb, setCrumb] = useState<CrumbAnswer | null>(null);
  const [crust, setCrust] = useState<CrustAnswer | null>(null);
  const [result, setResult] = useState<ReturnType<typeof diagnose> | null>(null);
  const [photoPath, setPhotoPath] = useState<PhotoPath>('answers');
  const [analyzing, setAnalyzing] = useState(false);

  const avgBulk =
    bakeLogs.length > 0
      ? bakeLogs.reduce((s, l) => s + l.bulkDurationMinutes, 0) / bakeLogs.length
      : null;

  const recentLog = bakeLogs[0] ?? null;
  const bulkMins = recentLog?.bulkDurationMinutes ?? Math.round(avgBulk ?? 0);
  const foldCount = recentLog?.foldCount ?? 0;

  const canDiagnose = shape !== null && crumb !== null && crust !== null;

  async function pickPhoto(setter: (uri: string) => void, useCamera: boolean) {
    if (Platform.OS === 'web') return;
    try {
      const { status } = useCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') return;
      const res = useCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (!res.canceled && res.assets[0]?.uri) setter(res.assets[0].uri);
    } catch {}
  }

  async function handleDiagnose() {
    if (!shape || !crumb || !crust) return;

    // Start from the answers-only input (today's behavior).
    let input = buildClassifierInput(shape, crumb, crust, bulkMins, foldCount, avgBulk);
    let path: PhotoPath = 'answers';

    // A crumb photo, when present, beats memory: it supplies crumbProbs and the
    // vision booleans it can actually see. The crumb question still contributes
    // megaPocketsNearCrust (the heuristic can't detect it) and stays as the
    // tiebreaker. Exterior signals remain question-driven. Web has no picker, so
    // crumbUri is null there; we still guard on Platform for safety.
    if (crumbUri && Platform.OS !== 'web') {
      setAnalyzing(true);
      try {
        const vf = await analyzeCrumbPhoto(crumbUri);
        input = {
          ...input,
          crumbProbs: vf.crumbProbs,
          evenHoles: vf.evenHoles,
          topHeavyHoles: vf.topHeavyHoles,
          tunnelingDetected: vf.tunnelingDetected,
          gummyDetected: vf.gummyDetected,
        };
        path = vf.probSource; // 'model' | 'heuristic'
      } catch (e) {
        // Never block a diagnosis on a bad photo — fall back to the answers.
        console.warn('[diagnose] crumb photo analysis failed; using answers only.', e);
        path = 'answers';
      } finally {
        setAnalyzing(false);
      }
    }

    setPhotoPath(path);
    setResult(diagnose(input));
  }

  function handleReset() {
    setShape(null);
    setCrumb(null);
    setCrust(null);
    setResult(null);
    setPhotoPath('answers');
    setCrumbUri(null);
    setExteriorUri(null);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 24, paddingBottom: 60 }}>

      {/* Header */}
      <Text style={{ color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.3, marginBottom: 4 }}>
        Diagnose Crumb
      </Text>
      <Text style={{ color: C.textMuted, fontSize: 15, marginBottom: 28, lineHeight: 22 }}>
        Answer 3 visual questions to diagnose your loaf.
      </Text>

      {/* Photos */}
      <SectionLabel
        badge="BETA"
        hint={
          Platform.OS === 'web'
            ? 'Crumb-photo analysis runs on-device (not available on web). Exterior is reference only.'
            : 'Attach a crumb cross-section and it’s analyzed on-device on Diagnose. Exterior is reference only.'
        }>
        Photos
      </SectionLabel>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 28 }}>
        <PhotoSlot
          label="Crumb cross-section"
          uri={crumbUri}
          onCamera={() => pickPhoto(setCrumbUri, true)}
          onLibrary={() => pickPhoto(setCrumbUri, false)}
        />
        <PhotoSlot
          label="Loaf exterior"
          uri={exteriorUri}
          onCamera={() => pickPhoto(setExteriorUri, true)}
          onLibrary={() => pickPhoto(setExteriorUri, false)}
        />
      </View>

      {/* Q1: Loaf shape */}
      <SectionLabel hint="Side profile — how does the silhouette look?">Loaf Shape</SectionLabel>
      <OptionGroup
        options={SHAPE_OPTIONS}
        selected={shape}
        onSelect={(v) => { setShape(v as ShapeAnswer); setResult(null); }}
      />

      {/* Q2: Crumb interior */}
      <SectionLabel hint="Looking at the cut face">Crumb Interior</SectionLabel>
      <OptionGroup
        options={CRUMB_OPTIONS}
        selected={crumb}
        onSelect={(v) => { setCrumb(v as CrumbAnswer); setResult(null); }}
      />

      {/* Q3: Crust & score */}
      <SectionLabel hint="Crust color + what happened at the score line">Crust & Score</SectionLabel>
      <OptionGroup
        options={CRUST_OPTIONS}
        selected={crust}
        onSelect={(v) => { setCrust(v as CrustAnswer); setResult(null); }}
      />

      {/* Diagnose button */}
      {!result && (
        <TouchableOpacity
          onPress={handleDiagnose}
          disabled={!canDiagnose || analyzing}
          activeOpacity={0.8}
          style={{
            backgroundColor: canDiagnose ? C.accent : 'rgba(255,255,255,0.06)',
            borderRadius: 22,
            paddingVertical: 22,
            alignItems: 'center',
            marginTop: 4,
            opacity: analyzing ? 0.85 : 1,
            shadowColor: canDiagnose ? C.accent : 'transparent',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.3,
            shadowRadius: 20,
          }}>
          {analyzing ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color="#0c0c0f" />
              <Text style={{ color: '#0c0c0f', fontSize: 19, fontWeight: '800', letterSpacing: -0.2 }}>
                Analyzing photo…
              </Text>
            </View>
          ) : (
            <Text
              style={{
                color: canDiagnose ? '#0c0c0f' : C.textDim,
                fontSize: 19,
                fontWeight: '800',
                letterSpacing: -0.2,
              }}>
              Diagnose
            </Text>
          )}
        </TouchableOpacity>
      )}

      {/* Diagnosis result */}
      {result && (
        <DiagnosisCard
          result={result}
          avgBulkMins={avgBulk}
          bakeCount={bakeLogs.length}
          photoPath={photoPath}
          onReset={handleReset}
        />
      )}
    </ScrollView>
  );
}

// ── SectionLabel ───────────────────────────────────────────────────────────

function SectionLabel({ children, hint, badge }: { children: string; hint?: string; badge?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text
          style={{
            color: C.textDim,
            fontSize: 11,
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: 2,
          }}>
          {children}
        </Text>
        {badge && (
          <View
            style={{
              backgroundColor: C.accentSoft,
              borderWidth: 1,
              borderColor: C.accentBorder,
              borderRadius: 6,
              paddingHorizontal: 6,
              paddingVertical: 1,
            }}>
            <Text style={{ color: C.accent, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>
              {badge}
            </Text>
          </View>
        )}
      </View>
      {hint && (
        <Text style={{ color: C.textDim, fontSize: 12, marginTop: 2 }}>{hint}</Text>
      )}
    </View>
  );
}

// ── PhotoSlot ──────────────────────────────────────────────────────────────

function PhotoSlot({
  label,
  uri,
  onCamera,
  onLibrary,
}: {
  label: string;
  uri: string | null;
  onCamera: () => void;
  onLibrary: () => void;
}) {
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <View
        style={{
          height: 130,
          borderRadius: 16,
          overflow: 'hidden',
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: uri ? C.accentBorder : C.cardBorder,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {uri ? (
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <View style={{ alignItems: 'center', gap: 8 }}>
            <ImagePlus color={C.textDim} size={26} />
            <Text
              style={{
                color: C.textDim,
                fontSize: 11,
                textAlign: 'center',
                paddingHorizontal: 10,
                lineHeight: 16,
              }}>
              {label}
            </Text>
          </View>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 5 }}>
        <TouchableOpacity
          onPress={onCamera}
          activeOpacity={0.7}
          style={{
            flex: 1,
            backgroundColor: C.card,
            borderWidth: 1,
            borderColor: C.cardBorder,
            borderRadius: 10,
            paddingVertical: 9,
            alignItems: 'center',
          }}>
          <Camera color={C.textMuted} size={16} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onLibrary}
          activeOpacity={0.7}
          style={{
            flex: 1,
            backgroundColor: C.card,
            borderWidth: 1,
            borderColor: C.cardBorder,
            borderRadius: 10,
            paddingVertical: 9,
            alignItems: 'center',
          }}>
          <ImagePlus color={C.textMuted} size={16} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── OptionGroup ────────────────────────────────────────────────────────────

function OptionGroup({
  options,
  selected,
  onSelect,
}: {
  options: { value: string; label: string; sub: string }[];
  selected: string | null;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={{ gap: 8, marginBottom: 28 }}>
      {options.map(({ value, label, sub }) => {
        const active = selected === value;
        return (
          <TouchableOpacity
            key={value}
            onPress={() => onSelect(value)}
            activeOpacity={0.7}
            style={{
              backgroundColor: active ? C.accentSoft : C.card,
              borderWidth: 1.5,
              borderColor: active ? C.accent : C.cardBorder,
              borderRadius: 16,
              padding: 16,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
            }}>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                borderWidth: active ? 0 : 1.5,
                borderColor: C.textDim,
                backgroundColor: active ? C.accent : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              {active && (
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: '#0c0c0f',
                  }}
                />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: active ? C.accent : C.text,
                  fontSize: 15,
                  fontWeight: '600',
                }}>
                {label}
              </Text>
              <Text
                style={{
                  color: active ? 'rgba(245,158,11,0.6)' : C.textDim,
                  fontSize: 12,
                  marginTop: 2,
                }}>
                {sub}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── DiagnosisCard ──────────────────────────────────────────────────────────

function DiagnosisCard({
  result,
  avgBulkMins,
  bakeCount,
  photoPath,
  onReset,
}: {
  result: ReturnType<typeof diagnose>;
  avgBulkMins: number | null;
  bakeCount: number;
  photoPath: PhotoPath;
  onReset: () => void;
}) {
  const copy = DIAGNOSIS_COPY[result.diagnosis];
  const colors = diagColors(result.diagnosis);
  const confPct = Math.round(result.confidence * 100);

  return (
    <View style={{ marginTop: 8, gap: 10 }}>
      {/* Main result card */}
      <View
        style={{
          backgroundColor: colors.bg,
          borderWidth: 1.5,
          borderColor: colors.border,
          borderRadius: 22,
          padding: 24,
        }}>
        {/* Title row */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <Text style={{ fontSize: 36, lineHeight: 44 }}>{copy.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.text,
                fontSize: 21,
                fontWeight: '800',
                letterSpacing: -0.3,
                lineHeight: 26,
              }}>
              {copy.title}
            </Text>
            <Text style={{ color: C.textDim, fontSize: 12, marginTop: 3 }}>
              {confPct}% confidence
            </Text>
          </View>
          {/* Confidence ring */}
          <View
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              borderWidth: 2.5,
              borderColor: colors.border,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 2,
            }}>
            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>
              {confPct}%
            </Text>
          </View>
        </View>

        {/* One-liner */}
        <Text
          style={{
            color: C.text,
            fontSize: 15,
            fontWeight: '600',
            lineHeight: 22,
            marginBottom: 12,
          }}>
          {copy.oneLiner}
        </Text>

        {/* Why card */}
        <View
          style={{
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderRadius: 14,
            padding: 14,
            marginBottom: avgBulkMins !== null ? 12 : 0,
          }}>
          <Text
            style={{
              color: C.textDim,
              fontSize: 10,
              fontWeight: '700',
              textTransform: 'uppercase',
              letterSpacing: 1.5,
              marginBottom: 6,
            }}>
            Reasoning
          </Text>
          <Text style={{ color: C.textMuted, fontSize: 13, lineHeight: 19 }}>
            {result.reasoning}
          </Text>
          <Text style={{ color: C.textDim, fontSize: 11, marginTop: 8, fontStyle: 'italic' }}>
            {PHOTO_PATH_LABEL[photoPath]}
          </Text>
        </View>

        {/* History context */}
        {avgBulkMins !== null && (
          <Text style={{ color: C.textDim, fontSize: 12 }}>
            Your avg bulk: {Math.round(avgBulkMins)}min across {bakeCount} bake
            {bakeCount !== 1 ? 's' : ''}
          </Text>
        )}
      </View>

      {/* Expanded why */}
      <View
        style={{
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.cardBorder,
          borderRadius: 18,
          padding: 20,
        }}>
        <Text
          style={{
            color: C.textDim,
            fontSize: 10,
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: 1.5,
            marginBottom: 8,
          }}>
          Why this happens
        </Text>
        <Text style={{ color: C.textMuted, fontSize: 13, lineHeight: 20 }}>
          {copy.expandedWhy}
        </Text>
      </View>

      {/* Reset button */}
      <TouchableOpacity
        onPress={onReset}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingVertical: 16,
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.cardBorder,
          borderRadius: 18,
        }}>
        <RotateCcw color={C.textMuted} size={16} />
        <Text style={{ color: C.textMuted, fontSize: 15, fontWeight: '600' }}>
          Diagnose Another Loaf
        </Text>
      </TouchableOpacity>
    </View>
  );
}
