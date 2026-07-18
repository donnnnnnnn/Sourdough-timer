import { useRef, useState } from 'react';
import { Image, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { captureRef } from 'react-native-view-shot';

import { useBakeStore, type Diagnosis, type PendingSession, type BakeLog } from '@/store/useBakeStore';
import { diagnose, type ClassifierInput, type ShoulderProfile } from '@/model/classifier';
import { analyzeCrumbPhoto, type CrumbVisionFeatures } from '@/model/visionAnalyzer';
import { DIAGNOSIS_COPY } from '@/model/training-data';
import { formatTemp } from '@/lib/bulkCoach';
import { C, fonts } from '@/components/theme';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { DoughButton } from '@/components/ui/DoughButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { FoldHud } from '@/components/ui/FoldHud';
import { Gauge } from '@/components/ui/Gauge';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ScanOverlay } from '@/components/ui/ScanOverlay';
import { Sheet } from '@/components/ui/Sheet';
import { Squish } from '@/components/ui/Squish';

// ─── Verdict styling: every diagnosis gets a glyph + warm semantic color ────

const VERDICT: Record<Diagnosis, { icon: IconName; color: string; soft: string }> = {
  properly_fermented: { icon: 'check', color: C.green, soft: C.greenSoft },
  under_fermented: { icon: 'clock', color: C.straw, soft: 'rgba(201,179,126,0.14)' },
  slightly_under: { icon: 'clock', color: C.straw, soft: 'rgba(201,179,126,0.14)' },
  slightly_over: { icon: 'droop', color: C.ember, soft: C.emberSoft },
  over_fermented: { icon: 'droop', color: C.ember, soft: C.emberSoft },
  weak_shaping: { icon: 'fold', color: C.violet, soft: C.violetSoft },
  fools_crumb: { icon: 'crumb', color: C.violet, soft: C.violetSoft },
  oven_artifact: { icon: 'flame', color: C.coral, soft: 'rgba(229,140,118,0.14)' },
};

const QUICK_OPTIONS: { diagnosis: Diagnosis; label: string; sub: string }[] = [
  { diagnosis: 'properly_fermented', label: 'Well fermented', sub: 'Good rise, open crumb, brown crust' },
  { diagnosis: 'under_fermented', label: 'Under-fermented', sub: 'Dense, pale, or gummy crumb' },
  { diagnosis: 'over_fermented', label: 'Over-fermented', sub: 'Flat, pale crust, slack dough' },
];

// ─── Tiebreaker questions (now with loaf silhouettes instead of emoji) ──────

const Q_SHAPE = {
  key: 'shape' as const,
  question: 'What does the side profile look like?',
  options: [
    { icon: 'loaf' as IconName, label: 'High even shoulders', value: 'high_even' },
    { icon: 'peak' as IconName, label: 'Peaked / triangular', value: 'pyramidal' },
    { icon: 'droop' as IconName, label: 'Sides drooping down', value: 'falling' },
    { icon: 'flat' as IconName, label: 'Flat / pancake', value: 'flat' },
  ],
};
const Q_CRUST = {
  key: 'crust' as const,
  question: 'What color is the crust?',
  options: [
    { swatch: '#E8D5B5', label: 'Pale / blonde', value: 'pale' },
    { swatch: '#C98A3B', label: 'Golden', value: 'golden' },
    { swatch: '#6B3F1D', label: 'Deep brown', value: 'deep_brown' },
  ],
};
const Q_TEXTURE = {
  key: 'texture' as const,
  question: 'How does the crumb feel?',
  options: [
    { icon: 'drop' as IconName, label: 'Gummy / sticks to knife', value: 'gummy' },
    { icon: 'check' as IconName, label: 'Moist but clean', value: 'clean' },
    { icon: 'flat' as IconName, label: 'Dry and heavy', value: 'dry' },
  ],
};

type TiebreakerAnswers = { shape?: string; crust?: string; texture?: string };

function pickTiebreakerQuestions(diag: Diagnosis) {
  if (diag === 'over_fermented' || diag === 'weak_shaping') return [Q_SHAPE, Q_CRUST];
  if (diag === 'under_fermented' || diag === 'fools_crumb') return [Q_SHAPE, Q_TEXTURE];
  return [Q_CRUST, Q_TEXTURE];
}

function formatMinutes(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function avgBulk(logs: { bulkDurationMinutes: number }[], n = 5): number | null {
  const recent = logs.slice(0, n);
  if (recent.length === 0) return null;
  return Math.round(recent.reduce((s, l) => s + l.bulkDurationMinutes, 0) / recent.length);
}

/** Consecutive dialed-in bakes, counted from the most recent. */
function dialedStreak(logs: BakeLog[]): number {
  let n = 0;
  for (const l of logs) {
    if (l.diagnosis === 'properly_fermented') n++;
    else break;
  }
  return n;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Copy a picked photo into the app's documents dir so it survives the
 * picker's cache being cleared. Falls back to the original uri on failure —
 * a missing thumbnail later beats blocking the save now.
 */
async function persistPhoto(uri: string, id: string): Promise<string> {
  if (Platform.OS === 'web') return uri;
  try {
    const { File, Paths } = await import('expo-file-system');
    const dest = new File(Paths.document, `bake-${id}.jpg`);
    new File(uri).copy(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

// ─── Small pieces ───────────────────────────────────────────────────────────

function Stat({ value, caption }: { value: string; caption: string }) {
  return (
    <Card padding={14} radius={16} style={{ flex: 1, alignItems: 'center' }}>
      <AppText role="stat" color={C.accent} style={{ fontSize: 22, lineHeight: 26, fontWeight: '300' }}>
        {value}
      </AppText>
      <AppText role="caption" style={{ fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 }}>
        {caption}
      </AppText>
    </Card>
  );
}

function VerdictChip({ diagnosis }: { diagnosis: Diagnosis }) {
  const v = VERDICT[diagnosis];
  const copy = DIAGNOSIS_COPY[diagnosis];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: v.soft,
        borderRadius: 999,
        paddingVertical: 4,
        paddingHorizontal: 10,
        alignSelf: 'flex-start',
      }}>
      <Icon name={v.icon} size={12} color={v.color} />
      <AppText
        role="caption"
        color={v.color}
        numberOfLines={1}
        style={{ fontWeight: '700', fontSize: 11.5, flexShrink: 1 }}>
        {copy.title}
      </AppText>
    </View>
  );
}

/** One loaf on the shelf: photo-led card, verdict chip, key numbers. */
function LoafCard({ item, onPress }: { item: BakeLog; onPress: () => void }) {
  return (
    <View style={{ width: '48%' }}>
      <Squish
        onPress={onPress}
        accessibilityLabel={`Bake from ${formatDate(item.timestamp)}: ${DIAGNOSIS_COPY[item.diagnosis].title}, ${formatMinutes(item.bulkDurationMinutes)} bulk`}>
        <Card padding={0} radius={20} style={{ overflow: 'hidden' }}>
        {item.photoUri ? (
          <Image source={{ uri: item.photoUri }} style={{ width: '100%', height: 120 }} resizeMode="cover" />
        ) : (
          <View
            style={{
              width: '100%',
              height: 120,
              backgroundColor: C.parchment2,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Icon name="crumb" size={40} color={C.straw} strokeWidth={1.3} />
          </View>
        )}
        <View style={{ padding: 12, gap: 6 }}>
          <AppText role="caption" style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' }}>
            {new Date(item.timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </AppText>
          <AppText role="emphasis" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
            {formatMinutes(item.bulkDurationMinutes)} · {item.foldCount} fold{item.foldCount !== 1 ? 's' : ''}
          </AppText>
          <VerdictChip diagnosis={item.diagnosis} />
        </View>
        </Card>
      </Squish>
    </View>
  );
}

type Step = 'sessions' | 'quick' | 'photo' | 'analyzing' | 'result' | 'tiebreaker';

export default function ShelfScreen() {
  const insets = useSafeAreaInsets();
  const pageTop = { padding: 24, paddingTop: insets.top + 16, paddingBottom: 48 };
  const { pendingSessions, bakeLogs, saveLog, lastEndedBulk, undoEndBulk, tempUnit } = useBakeStore();
  const [step, setStep] = useState<Step>('sessions');
  const [activeSession, setActiveSession] = useState<PendingSession | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [vision, setVision] = useState<CrumbVisionFeatures | null>(null);
  const [diagResult, setDiagResult] = useState<ReturnType<typeof diagnose> | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [tbAnswers, setTbAnswers] = useState<TiebreakerAnswers>({});
  const [scanError, setScanError] = useState(false);
  const [detailLog, setDetailLog] = useState<BakeLog | null>(null);
  const [sharing, setSharing] = useState(false);
  const shareCardRef = useRef<View>(null);

  const userAvg = avgBulk(bakeLogs);

  function selectSession(session: PendingSession) {
    setActiveSession(session);
    setStep('quick');
  }

  function handleQuickLog(diagnosis: Diagnosis) {
    if (!activeSession) return;
    saveLog(activeSession.id, diagnosis);
    resetToSessions();
  }

  async function handlePickPhoto(fromCamera: boolean) {
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    setPhotoUri(uri);
    setStep('analyzing');
    try {
      // The model is fast; the ritual isn't rushed. Hold the scan view long
      // enough to read one status line.
      const [features] = await Promise.all([analyzeCrumbPhoto(uri), delay(2600)]);
      setVision(features);
      runFusion(features, {});
    } catch {
      setScanError(true);
      setStep('photo');
    }
  }

  function runFusion(features: CrumbVisionFeatures, answers: TiebreakerAnswers) {
    const input: ClassifierInput = {
      crumbProbs: features.crumbProbs,
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
      bulkDurationMinutes: activeSession?.bulkDurationMinutes ?? 0,
      foldCount: activeSession?.foldCount ?? 0,
      userAverageBulkMinutes: userAvg,
    };
    const result = diagnose(input);
    setDiagResult(result);
    const answered = Object.keys(answers).length > 0;
    setStep(result.confidence >= 0.75 || answered ? 'result' : 'tiebreaker');
  }

  function handleTiebreakerAnswer(key: keyof TiebreakerAnswers, value: string) {
    if (!vision || !diagResult) return;
    const updated = { ...tbAnswers, [key]: value };
    setTbAnswers(updated);
    const questions = pickTiebreakerQuestions(diagResult.diagnosis);
    if (questions.every((q) => updated[q.key])) runFusion(vision, updated);
  }

  async function handleSaveResult() {
    if (!diagResult || !activeSession) return;
    const persisted = photoUri ? await persistPhoto(photoUri, activeSession.id) : undefined;
    saveLog(activeSession.id, diagResult.diagnosis as Diagnosis, persisted ? { photoUri: persisted } : undefined);
    resetToSessions();
  }

  async function handleShare() {
    if (Platform.OS === 'web' || !shareCardRef.current || sharing) return;
    setSharing(true);
    try {
      const uri = await captureRef(shareCardRef, { format: 'png', quality: 0.95 });
      const Sharing = await import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri.startsWith('file://') ? uri : `file://${uri}`);
      }
    } catch {
      // sharing is a bonus — never let it error the shelf
    } finally {
      setSharing(false);
    }
  }

  function resetToSessions() {
    setStep('sessions');
    setActiveSession(null);
    setDiagResult(null);
    setPhotoUri(null);
    setVision(null);
    setWhyOpen(false);
    setTbAnswers({});
  }

  function resetPhotoFlow() {
    setStep('photo');
    setDiagResult(null);
    setPhotoUri(null);
    setVision(null);
    setWhyOpen(false);
    setTbAnswers({});
  }

  function BackLink({ onPress, label = 'Back' }: { onPress: () => void; label?: string }) {
    return (
      <Squish
        onPress={onPress}
        accessibilityLabel={label}
        hitSlop={8}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginBottom: 20, paddingVertical: 6 }}>
        <View style={{ transform: [{ scaleX: -1 }] }}>
          <Icon name="chevronRight" size={15} color={C.accent} />
        </View>
        <AppText role="emphasis" color={C.accent} style={{ fontSize: 15 }}>
          {label}
        </AppText>
      </Squish>
    );
  }

  // ── The Shelf ─────────────────────────────────────────────────────────────
  if (step === 'sessions') {
    const streak = dialedStreak(bakeLogs);
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <FoldHud />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={pageTop}>
          <AppText role="displayLg">The Shelf</AppText>
          <AppText role="body" color={C.textMuted} style={{ fontSize: 16, marginTop: 4, marginBottom: 24 }}>
            Every loaf teaches the next one.
          </AppText>

          {lastEndedBulk && (
            <Squish
              onPress={() => {
                undoEndBulk();
                router.push('/');
              }}
              accessibilityLabel="Undo ending the bulk and return to the timer"
              style={{ marginBottom: 20 }}>
              <Card padding={16} radius={18}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Icon name="undo" size={18} color={C.accent} />
                  <View style={{ flex: 1 }}>
                    <AppText role="emphasis" style={{ fontSize: 15 }}>
                      Tapped finish by mistake?
                    </AppText>
                    <AppText role="caption" style={{ marginTop: 2 }}>
                      Jump back into the timer right where it left off
                    </AppText>
                  </View>
                  <Icon name="chevronRight" size={16} color={C.textDim} />
                </View>
              </Card>
            </Squish>
          )}

          {pendingSessions.length > 0 && (
            <>
              <AppText role="label" style={{ marginBottom: 12 }}>
                Ready to log
              </AppText>
              <View style={{ gap: 12, marginBottom: 28 }}>
                {pendingSessions.map((session) => (
                  <Squish
                    key={session.id}
                    onPress={() => selectSession(session)}
                    accessibilityLabel={`Log the ${formatMinutes(session.bulkDurationMinutes)} bulk from ${formatDate(session.timestamp)}`}>
                    <Card padding={18} radius={20}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                        <View
                          style={{
                            width: 46,
                            height: 46,
                            borderRadius: 16,
                            backgroundColor: C.accentSoft,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                          <Icon name="jar" size={24} color={C.accent} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <AppText role="emphasis">
                            {formatMinutes(session.bulkDurationMinutes)} bulk · {session.foldCount} fold
                            {session.foldCount !== 1 ? 's' : ''}
                          </AppText>
                          <AppText role="caption" style={{ marginTop: 2 }}>
                            {formatDate(session.timestamp)}
                            {session.doughTempF ? ` · ${formatTemp(session.doughTempF, tempUnit)}` : ''}
                          </AppText>
                        </View>
                        <Icon name="chevronRight" size={16} color={C.accent} />
                      </View>
                    </Card>
                  </Squish>
                ))}
              </View>
            </>
          )}

          {bakeLogs.length === 0 ? (
            <EmptyState
              icon="shelf"
              title="Your shelf is waiting for its first loaf."
              body="Finish a bulk ferment and log how the crumb turned out — scan it with a photo and it lives here, crust and all."
              actionLabel="Start a bake"
              onAction={() => router.push('/')}
            />
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                <Stat value={String(bakeLogs.length)} caption="bakes" />
                <Stat
                  value={formatMinutes(Math.round(bakeLogs.reduce((s, l) => s + l.bulkDurationMinutes, 0) / bakeLogs.length))}
                  caption="avg bulk"
                />
                <Stat value={streak > 0 ? `${streak}×` : String(bakeLogs.filter((l) => l.diagnosis === 'properly_fermented').length)} caption={streak > 0 ? 'streak' : 'dialed in'} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, justifyContent: 'space-between' }}>
                {bakeLogs.map((item) => (
                  <LoafCard key={item.id} item={item} onPress={() => setDetailLog(item)} />
                ))}
              </View>
            </>
          )}
        </ScrollView>

        {/* Bake detail + share card */}
        <Sheet visible={detailLog !== null} onClose={() => setDetailLog(null)}>
          {detailLog && (
            <View>
              {/* The share card: what gets captured and sent to the group chat */}
              <View
                ref={shareCardRef}
                collapsable={false}
                style={{ backgroundColor: C.parchment, borderRadius: 20, overflow: 'hidden' }}>
                {detailLog.photoUri ? (
                  <Image source={{ uri: detailLog.photoUri }} style={{ width: '100%', height: 190 }} resizeMode="cover" />
                ) : (
                  <View
                    style={{ width: '100%', height: 110, backgroundColor: C.parchment2, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="loaf" size={46} color={C.straw} strokeWidth={1.3} />
                  </View>
                )}
                <View style={{ padding: 16, gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <AppText role="display" style={{ fontSize: 22 }}>
                      {DIAGNOSIS_COPY[detailLog.diagnosis].title}
                    </AppText>
                    <Icon name={VERDICT[detailLog.diagnosis].icon} size={20} color={VERDICT[detailLog.diagnosis].color} />
                  </View>
                  <AppText role="caption">
                    {new Date(detailLog.timestamp).toLocaleDateString(undefined, {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </AppText>
                  <View style={{ flexDirection: 'row', gap: 14, marginTop: 2, flexWrap: 'wrap' }}>
                    <AppText role="caption" color={C.textMuted} style={{ fontVariant: ['tabular-nums'] }}>
                      {formatMinutes(detailLog.bulkDurationMinutes)} bulk
                    </AppText>
                    <AppText role="caption" color={C.textMuted}>
                      {detailLog.foldCount} fold{detailLog.foldCount !== 1 ? 's' : ''}
                    </AppText>
                    {detailLog.doughTempF ? (
                      <AppText role="caption" color={C.textMuted}>
                        {formatTemp(detailLog.doughTempF, tempUnit)} kitchen
                      </AppText>
                    ) : null}
                    {detailLog.risePercent ? (
                      <AppText role="caption" color={C.textMuted}>
                        {detailLog.risePercent}% rise
                      </AppText>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <Icon name="bubbles" size={13} color={C.straw} />
                    <AppText role="caption" style={{ fontFamily: fonts.display, color: C.straw }}>
                      Sourdough Timer
                    </AppText>
                  </View>
                </View>
              </View>

              <AppText role="body" color={C.textMuted} style={{ marginTop: 14 }}>
                {DIAGNOSIS_COPY[detailLog.diagnosis].oneLiner}
              </AppText>

              <View style={{ gap: 10, marginTop: 18 }}>
                {Platform.OS !== 'web' && (
                  <DoughButton
                    label={sharing ? 'Preparing…' : 'Share this bake'}
                    icon="share"
                    onPress={handleShare}
                    variant="cream"
                    size="md"
                    disabled={sharing}
                  />
                )}
                <DoughButton label="Close" onPress={() => setDetailLog(null)} variant="quiet" size="md" />
              </View>
            </View>
          )}
        </Sheet>
      </View>
    );
  }

  // ── Scan ritual ───────────────────────────────────────────────────────────
  if (step === 'analyzing') {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', padding: 24 }}>
        {photoUri && <ScanOverlay uri={photoUri} />}
        <AppText role="caption" center style={{ marginTop: 14 }}>
          on-device · offline · private
        </AppText>
      </View>
    );
  }

  // ── Tiebreaker ────────────────────────────────────────────────────────────
  if (step === 'tiebreaker' && diagResult) {
    const tbQuestions = pickTiebreakerQuestions(diagResult.diagnosis);
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={pageTop}>
        <BackLink onPress={resetToSessions} />
        <AppText role="display">One more look at the loaf</AppText>
        <AppText role="body" color={C.textMuted} style={{ marginTop: 6, marginBottom: 26 }}>
          {diagResult.reasoning}
        </AppText>
        {tbQuestions.map((q) => (
          <View key={q.key} style={{ marginBottom: 24 }}>
            <AppText role="label" style={{ marginBottom: 12 }}>
              {q.question}
            </AppText>
            <View style={{ gap: 8 }}>
              {q.options.map((opt) => {
                const active = tbAnswers[q.key] === opt.value;
                return (
                  <Squish
                    key={opt.value}
                    onPress={() => handleTiebreakerAnswer(q.key, opt.value)}
                    accessibilityLabel={`${opt.label}${active ? ', selected' : ''}`}>
                    <Card
                      padding={16}
                      radius={18}
                      tone={active ? 'accent' : 'parchment'}
                      style={active ? { borderWidth: 1.5, borderColor: C.accent } : undefined}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                        {'icon' in opt ? (
                          <Icon name={opt.icon} size={24} color={active ? C.accent : C.textMuted} strokeWidth={1.6} />
                        ) : (
                          <View
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 11,
                              backgroundColor: (opt as { swatch: string }).swatch,
                            }}
                          />
                        )}
                        <AppText role="emphasis" color={active ? C.accent : C.text} style={{ fontSize: 15 }}>
                          {opt.label}
                        </AppText>
                      </View>
                    </Card>
                  </Squish>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    );
  }

  // ── Report card ───────────────────────────────────────────────────────────
  if (step === 'result' && diagResult) {
    const copy = DIAGNOSIS_COPY[diagResult.diagnosis as keyof typeof DIAGNOSIS_COPY];
    const v = VERDICT[diagResult.diagnosis as Diagnosis];
    const sourceNote =
      vision?.probSource === 'model'
        ? 'read by the on-device model'
        : vision?.probSource === 'heuristic'
          ? 'read by the built-in heuristic (beta)'
          : 'from your answers';
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={pageTop}>
        <BackLink onPress={resetToSessions} />

        {photoUri && (
          <Image
            source={{ uri: photoUri }}
            style={{ width: '100%', height: 190, borderRadius: 20, marginBottom: 16 }}
            resizeMode="cover"
          />
        )}

        <Card padding={20} radius={24} tone="parchment">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Gauge value={diagResult.confidence} color={v.color} size={104} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name={v.icon} size={20} color={v.color} />
                <AppText role="display" style={{ fontSize: 23, flexShrink: 1 }}>
                  {copy.title}
                </AppText>
              </View>
              <AppText role="caption" style={{ marginTop: 4 }}>
                {sourceNote}
              </AppText>
            </View>
          </View>

          <AppText role="body" color={C.text} style={{ fontSize: 15.5, marginTop: 16 }}>
            {copy.oneLiner}
          </AppText>

          <Squish
            onPress={() => setWhyOpen((o) => !o)}
            accessibilityLabel={whyOpen ? 'Hide the explanation' : 'Show why this happens'}
            style={{ alignSelf: 'flex-start', marginTop: 14, backgroundColor: C.parchment2, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 }}>
            <AppText role="caption" color={C.textMuted} style={{ fontWeight: '600' }}>
              {whyOpen ? 'Hide explanation' : 'Why does this happen?'}
            </AppText>
          </Squish>
          {whyOpen && (
            <AppText role="body" color={C.textMuted} style={{ marginTop: 12 }}>
              {copy.expandedWhy}
            </AppText>
          )}
        </Card>

        <View style={{ gap: 10, marginTop: 18 }}>
          <DoughButton label="Save to the shelf" icon="shelf" onPress={handleSaveResult} variant="cream" />
          <DoughButton label="Try another photo" onPress={resetPhotoFlow} variant="quiet" size="md" />
        </View>
      </ScrollView>
    );
  }

  // ── Photo step ────────────────────────────────────────────────────────────
  if (step === 'photo') {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={pageTop}>
          <BackLink onPress={() => setStep('quick')} />
          <AppText role="display">Scan the crumb</AppText>
          <AppText role="body" color={C.textMuted} style={{ marginTop: 6 }}>
            Cut the loaf in half, then photograph the cut face straight-on in good light.
          </AppText>
          <AppText role="caption" style={{ marginTop: 8, marginBottom: 30 }}>
            Analysis runs entirely on your device — offline, private, free.
          </AppText>

          <View style={{ gap: 10 }}>
            <DoughButton label="Take a photo" icon="camera" onPress={() => handlePickPhoto(true)} variant="honey" />
            <DoughButton label="Choose from library" onPress={() => handlePickPhoto(false)} variant="quiet" size="md" />
          </View>
        </ScrollView>

        <Sheet visible={scanError} onClose={() => setScanError(false)} title="Couldn't read that photo">
          <AppText role="body" color={C.textMuted} style={{ marginBottom: 18 }}>
            The crumb needs to fill the frame in even light — glare and shadows hide the holes. Try a clearer,
            straight-on shot of the cut face.
          </AppText>
          <View style={{ gap: 10 }}>
            <DoughButton label="Try again" icon="camera" onPress={() => { setScanError(false); handlePickPhoto(true); }} variant="soft" size="md" />
            <DoughButton label="Answer by eye instead" onPress={() => { setScanError(false); setStep('quick'); }} variant="quiet" size="md" />
          </View>
        </Sheet>
      </View>
    );
  }

  // ── Quick log ─────────────────────────────────────────────────────────────
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={pageTop}>
      <BackLink onPress={resetToSessions} />

      {activeSession && (
        <Card padding={16} radius={18} style={{ marginBottom: 22 }}>
          <AppText role="label" style={{ marginBottom: 4 }}>
            Logging this bake
          </AppText>
          <AppText role="emphasis">
            {formatMinutes(activeSession.bulkDurationMinutes)} bulk · {activeSession.foldCount} fold
            {activeSession.foldCount !== 1 ? 's' : ''}
            {activeSession.doughTempF ? ` · ${formatTemp(activeSession.doughTempF, tempUnit)}` : ''}
          </AppText>
          <AppText role="caption" style={{ marginTop: 2 }}>
            {formatDate(activeSession.timestamp)}
          </AppText>
        </Card>
      )}

      <AppText role="display">How'd it turn out?</AppText>
      <AppText role="body" color={C.textMuted} style={{ marginTop: 4, marginBottom: 24 }}>
        Quick log by eye, or scan the crumb for a reading.
      </AppText>

      <View style={{ gap: 12, marginBottom: 14 }}>
        {QUICK_OPTIONS.map(({ diagnosis, label, sub }) => {
          const v = VERDICT[diagnosis];
          return (
            <Squish key={diagnosis} onPress={() => handleQuickLog(diagnosis)} accessibilityLabel={`${label}: ${sub}`}>
              <Card padding={18} radius={20}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                  <View
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: 16,
                      backgroundColor: v.soft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <Icon name={v.icon} size={24} color={v.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText role="emphasis">{label}</AppText>
                    <AppText role="caption" style={{ marginTop: 2 }}>
                      {sub}
                    </AppText>
                  </View>
                </View>
              </Card>
            </Squish>
          );
        })}
      </View>

      <DoughButton
        label="Not sure? Scan the crumb"
        icon="camera"
        onPress={() => setStep('photo')}
        variant="soft"
        size="md"
        accessibilityHint="Takes a crumb photo and reads it on this device"
      />
    </ScrollView>
  );
}
