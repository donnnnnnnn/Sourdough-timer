import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'lucide-react-native';
import { useBakeStore, type Diagnosis } from '@/store/useBakeStore';
import { diagnose, type ClassifierInput, type ShoulderProfile } from '@/model/classifier';
import { analyzeCrumbPhoto, type CrumbVisionFeatures } from '@/model/visionAnalyzer';
import { DIAGNOSIS_COPY } from '@/model/training-data';

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
};

const QUICK_OPTIONS: { diagnosis: Diagnosis; emoji: string; label: string; sub: string }[] = [
  { diagnosis: 'properly_fermented', emoji: '✅', label: 'Well fermented', sub: 'Good rise, open crumb, brown crust' },
  { diagnosis: 'under_fermented',    emoji: '⏱️', label: 'Under-fermented', sub: 'Dense, pale, or gummy crumb' },
  { diagnosis: 'over_fermented',     emoji: '🫠', label: 'Over-fermented', sub: 'Flat, pale crust, slack dough' },
];

const Q_SHAPE = {
  key: 'shape' as const,
  question: 'What does the side profile look like?',
  options: [
    { label: '🐰 High even shoulders', value: 'high_even' },
    { label: '🔺 Peaked / triangular', value: 'pyramidal' },
    { label: '📉 Sides drooping down', value: 'falling' },
    { label: '🫓 Flat / pancake', value: 'flat' },
  ],
};
const Q_CRUST = {
  key: 'crust' as const,
  question: 'What color is the crust?',
  options: [
    { label: '⬜ Pale / blonde', value: 'pale' },
    { label: '🟡 Golden', value: 'golden' },
    { label: '🟤 Deep brown', value: 'deep_brown' },
  ],
};
const Q_TEXTURE = {
  key: 'texture' as const,
  question: 'How does the crumb feel?',
  options: [
    { label: '💧 Gummy / sticks to knife', value: 'gummy' },
    { label: '✅ Moist but clean', value: 'clean' },
    { label: '🪨 Dry and heavy', value: 'dry' },
  ],
};

type TiebreakerAnswers = { shape?: string; crust?: string; texture?: string };

function pickTiebreakerQuestions(diag: Diagnosis) {
  if (diag === 'over_fermented' || diag === 'weak_shaping') return [Q_SHAPE, Q_CRUST];
  if (diag === 'under_fermented' || diag === 'fools_crumb') return [Q_SHAPE, Q_TEXTURE];
  return [Q_CRUST, Q_TEXTURE];
}

function avgBulk(logs: { bulkDurationMinutes: number }[], n = 5): number | null {
  const recent = logs.slice(0, n);
  if (recent.length === 0) return null;
  return Math.round(recent.reduce((s, l) => s + l.bulkDurationMinutes, 0) / recent.length);
}

type Step = 'quick' | 'photo' | 'analysing' | 'result' | 'tiebreaker';

export default function LogScreen() {
  const { lastBulkDurationMinutes, lastFoldCount, bakeLogs, saveLog } = useBakeStore();
  const [step, setStep] = useState<Step>('quick');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [vision, setVision] = useState<CrumbVisionFeatures | null>(null);
  const [diagResult, setDiagResult] = useState<ReturnType<typeof diagnose> | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [tbAnswers, setTbAnswers] = useState<TiebreakerAnswers>({});

  const hasPending = lastBulkDurationMinutes !== null;
  const userAvg = avgBulk(bakeLogs);

  function handleQuickLog(diagnosis: Diagnosis) {
    saveLog(diagnosis);
    router.push('/');
  }

  async function handlePickPhoto(fromCamera: boolean) {
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    setPhotoUri(uri);
    setStep('analysing');
    try {
      const features = await analyzeCrumbPhoto(uri);
      setVision(features);
      runFusion(features, {});
    } catch (e) {
      Alert.alert('Analysis failed', 'Could not read that photo. Try a clearer, well-lit shot of the cut face.');
      setStep('photo');
    }
  }

  function runFusion(features: CrumbVisionFeatures, answers: TiebreakerAnswers) {
    const input: ClassifierInput = {
      crumbProbs: features.crumbProbs,
      // Photo-derived signals; tiebreaker answers override when present
      shapeFlat: answers.shape ? answers.shape === 'flat' : false,
      crustPale: answers.crust ? answers.crust === 'pale' : false,
      gummyDetected: answers.texture ? answers.texture === 'gummy' : features.gummyDetected,
      evenHoles: answers.texture === 'clean' ? true : features.evenHoles,
      tunnelingDetected: features.tunnelingDetected,
      topHeavyHoles: features.topHeavyHoles,
      megaPocketsNearCrust: false,
      shoulderProfile: (answers.shape as ShoulderProfile) ?? 'unknown',
      glutenStrandsInBloom: false,
      bubblesInBloom: false,
      bulkDurationMinutes: lastBulkDurationMinutes ?? 0,
      foldCount: lastFoldCount ?? 0,
      userAverageBulkMinutes: userAvg,
    };
    const result = diagnose(input);
    setDiagResult(result);
    const answered = Object.keys(answers).length > 0;
    // After tiebreakers, always show the result — don't loop the user
    setStep(result.confidence >= 0.75 || answered ? 'result' : 'tiebreaker');
  }

  function handleTiebreakerAnswer(key: keyof TiebreakerAnswers, value: string) {
    if (!vision || !diagResult) return;
    const updated = { ...tbAnswers, [key]: value };
    setTbAnswers(updated);
    const questions = pickTiebreakerQuestions(diagResult.diagnosis);
    if (questions.every(q => updated[q.key])) runFusion(vision, updated);
  }

  function handleSaveResult() {
    if (!diagResult) return;
    saveLog(diagResult.diagnosis as Diagnosis);
    router.push('/');
  }

  function resetPhotoFlow() {
    setStep('photo');
    setDiagResult(null);
    setPhotoUri(null);
    setVision(null);
    setWhyOpen(false);
    setTbAnswers({});
  }

  if (!hasPending) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ fontSize: 56, marginBottom: 4, opacity: 0.8 }}>🍞</Text>
        <Text style={{ color: C.text, fontSize: 22, fontWeight: '700', textAlign: 'center', marginTop: 12, marginBottom: 6 }}>
          No bake in progress
        </Text>
        <Text style={{ color: C.textMuted, fontSize: 15, textAlign: 'center', marginBottom: 28, lineHeight: 22 }}>
          Complete a bulk fermentation first, then come back here to log your results.
        </Text>
        <TouchableOpacity
          onPress={() => router.push('/')}
          activeOpacity={0.8}
          style={{ backgroundColor: C.accent, borderRadius: 18, paddingVertical: 16, paddingHorizontal: 36 }}>
          <Text style={{ color: '#0c0c0f', fontSize: 16, fontWeight: '700' }}>Go to Timer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'analysing') {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        {photoUri && <Image source={{ uri: photoUri }} style={{ width: 200, height: 200, borderRadius: 20, opacity: 0.6 }} />}
        <ActivityIndicator color={C.accent} size="large" />
        <Text style={{ color: C.textMuted, fontSize: 15 }}>Analysing crumb…</Text>
      </View>
    );
  }

  if (step === 'tiebreaker' && diagResult) {
    const tbQuestions = pickTiebreakerQuestions(diagResult.diagnosis);
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
        <Text style={{ color: C.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.3, marginBottom: 6 }}>
          I need a bit more info
        </Text>
        <Text style={{ color: C.textMuted, fontSize: 15, marginBottom: 28, lineHeight: 22 }}>
          {diagResult.reasoning}
        </Text>
        {tbQuestions.map((q) => (
          <View key={q.key} style={{ marginBottom: 24 }}>
            <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 }}>
              {q.question}
            </Text>
            <View style={{ gap: 8 }}>
              {q.options.map((opt) => {
                const active = tbAnswers[q.key] === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => handleTiebreakerAnswer(q.key, opt.value)}
                    activeOpacity={0.7}
                    style={{
                      backgroundColor: active ? C.accentSoft : C.card,
                      borderWidth: 1.5,
                      borderColor: active ? C.accent : C.cardBorder,
                      borderRadius: 16,
                      paddingVertical: 16,
                      paddingHorizontal: 20,
                    }}>
                    <Text style={{ color: active ? C.accent : C.text, fontSize: 15, fontWeight: '600' }}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    );
  }

  if (step === 'result' && diagResult) {
    const copy = DIAGNOSIS_COPY[diagResult.diagnosis as keyof typeof DIAGNOSIS_COPY];
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
        <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16 }}>
          Diagnosis
        </Text>

        {photoUri && <Image source={{ uri: photoUri }} style={{ width: '100%', height: 200, borderRadius: 20, marginBottom: 20 }} />}

        <View style={{ backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentBorder, borderRadius: 24, padding: 24, marginBottom: 16 }}>
          <Text style={{ fontSize: 40, marginBottom: 8 }}>{copy.emoji}</Text>
          <Text style={{ color: C.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.3, marginBottom: 8 }}>{copy.title}</Text>
          <Text style={{ color: C.text, fontSize: 16, lineHeight: 24, marginBottom: 16 }}>{copy.oneLiner}</Text>

          <TouchableOpacity
            onPress={() => setWhyOpen(v => !v)}
            activeOpacity={0.7}
            style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start' }}>
            <Text style={{ color: C.textMuted, fontSize: 13, fontWeight: '600' }}>{whyOpen ? 'Hide explanation' : 'Why?'}</Text>
          </TouchableOpacity>

          {whyOpen && (
            <Text style={{ color: C.textMuted, fontSize: 14, lineHeight: 22, marginTop: 14 }}>{copy.expandedWhy}</Text>
          )}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
          <View style={{ backgroundColor: C.card, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14 }}>
            <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 }}>Confidence</Text>
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '700', marginTop: 2 }}>{Math.round(diagResult.confidence * 100)}%</Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={handleSaveResult}
          activeOpacity={0.8}
          style={{
            backgroundColor: C.accent,
            borderRadius: 20,
            paddingVertical: 20,
            alignItems: 'center',
            marginBottom: 12,
            shadowColor: C.accent,
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.3,
            shadowRadius: 20,
          }}>
          <Text style={{ color: '#0c0c0f', fontSize: 18, fontWeight: '800' }}>Save this result</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={resetPhotoFlow}
          activeOpacity={0.7}
          style={{ backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 20, paddingVertical: 16, alignItems: 'center' }}>
          <Text style={{ color: C.textMuted, fontSize: 16, fontWeight: '600' }}>Try again</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (step === 'photo') {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
        <TouchableOpacity onPress={() => setStep('quick')} activeOpacity={0.7} style={{ marginBottom: 24 }}>
          <Text style={{ color: C.accent, fontSize: 15, fontWeight: '600' }}>← Back</Text>
        </TouchableOpacity>

        <Text style={{ color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.3, marginBottom: 6 }}>
          Diagnose from photo
        </Text>
        <Text style={{ color: C.textMuted, fontSize: 15, marginBottom: 32, lineHeight: 22 }}>
          Slice the loaf, then photograph the cut face straight-on in good light. Analysis runs entirely on your device.
        </Text>

        <TouchableOpacity
          onPress={() => handlePickPhoto(true)}
          activeOpacity={0.8}
          style={{
            backgroundColor: C.accent,
            borderRadius: 20,
            paddingVertical: 22,
            alignItems: 'center',
            marginBottom: 12,
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 10,
            shadowColor: C.accent,
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.3,
            shadowRadius: 20,
          }}>
          <Camera color="#0c0c0f" size={22} />
          <Text style={{ color: '#0c0c0f', fontSize: 18, fontWeight: '800' }}>Take a photo</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => handlePickPhoto(false)}
          activeOpacity={0.7}
          style={{ backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 20, paddingVertical: 20, alignItems: 'center' }}>
          <Text style={{ color: C.text, fontSize: 16, fontWeight: '600' }}>Choose from library</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
      <Text style={{ color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.3, marginBottom: 4 }}>
        Log Your Bake
      </Text>
      <Text style={{ color: C.textMuted, fontSize: 15, marginBottom: 28 }}>
        How did the fermentation go?
      </Text>

      <View style={{ gap: 12, marginBottom: 12 }}>
        {QUICK_OPTIONS.map(({ diagnosis, emoji, label, sub }) => (
          <TouchableOpacity
            key={diagnosis}
            onPress={() => handleQuickLog(diagnosis)}
            activeOpacity={0.7}
            style={{
              backgroundColor: C.card,
              borderWidth: 1.5,
              borderColor: C.cardBorder,
              borderRadius: 22,
              padding: 22,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 18,
            }}>
            <Text style={{ fontSize: 34 }}>{emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 17, fontWeight: '700', marginBottom: 3 }}>{label}</Text>
              <Text style={{ color: C.textDim, fontSize: 13 }}>{sub}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        onPress={() => setStep('photo')}
        activeOpacity={0.7}
        style={{
          backgroundColor: C.accentSoft,
          borderWidth: 1.5,
          borderColor: C.accentBorder,
          borderRadius: 22,
          padding: 22,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 18,
        }}>
        <Camera color={C.accent} size={30} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.accent, fontSize: 17, fontWeight: '700', marginBottom: 3 }}>Not sure?</Text>
          <Text style={{ color: 'rgba(245,158,11,0.6)', fontSize: 13 }}>Take a crumb photo and I'll diagnose it</Text>
        </View>
      </TouchableOpacity>
    </ScrollView>
  );
}
