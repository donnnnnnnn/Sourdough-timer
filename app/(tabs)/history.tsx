import { View, Text, FlatList } from 'react-native';
import { useBakeStore, BakeLog } from '@/store/useBakeStore';
import { DIAGNOSIS_COPY } from '@/model/training-data';
import { C, fonts, label } from '@/components/theme';

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function Stat({ value, caption }: { value: string; caption: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 16, padding: 14, alignItems: 'center' }}>
      <Text style={{ color: C.accent, fontSize: 22, fontWeight: '300', fontFamily: fonts.mono }}>{value}</Text>
      <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 }}>{caption}</Text>
    </View>
  );
}

function BakeCard({ item }: { item: BakeLog }) {
  const copy = item.diagnosis ? DIAGNOSIS_COPY[item.diagnosis] : null;
  return (
    <View
      style={{
        backgroundColor: C.card,
        borderWidth: 1,
        borderColor: C.cardBorder,
        borderRadius: 20,
        padding: 20,
        marginBottom: 10,
      }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ ...label, letterSpacing: 1.2, marginBottom: 6 }}>
            {formatDate(item.timestamp)}
          </Text>
          <Text style={{ color: C.text, fontSize: 28, fontWeight: '200', letterSpacing: -1, fontFamily: fonts.mono }}>
            {formatDuration(item.bulkDurationMinutes)}
          </Text>
          <Text style={{ color: C.textMuted, fontSize: 14, marginTop: 4 }}>
            {item.foldCount} fold{item.foldCount !== 1 ? 's' : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6, marginTop: 4 }}>
          {copy ? (
            <View style={{ backgroundColor: C.chip, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 13 }}>{copy.emoji}</Text>
              <Text style={{ color: C.accent, fontSize: 13, fontWeight: '600' }}>{copy.title}</Text>
            </View>
          ) : (
            // Legacy logs saved before the diagnosis flow
            <>
              {item.crumbType && (
                <View style={{ backgroundColor: C.chip, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 12 }}>
                  <Text style={{ color: C.accent, fontSize: 13, fontWeight: '600' }}>{item.crumbType}</Text>
                </View>
              )}
              {item.shapeType && (
                <View style={{ backgroundColor: C.chip, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 12 }}>
                  <Text style={{ color: C.textMuted, fontSize: 13, fontWeight: '600' }}>{item.shapeType}</Text>
                </View>
              )}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

export default function HistoryScreen() {
  const { bakeLogs } = useBakeStore();

  if (bakeLogs.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ fontSize: 56, opacity: 0.7 }}>📖</Text>
        <Text style={{ color: C.text, fontSize: 24, fontFamily: fonts.display, textAlign: 'center', marginTop: 16, marginBottom: 8 }}>
          No bakes logged yet
        </Text>
        <Text style={{ color: C.textMuted, fontSize: 15, textAlign: 'center', lineHeight: 22 }}>
          Complete your first bulk fermentation and log the results to build your history.
        </Text>
      </View>
    );
  }

  const avgBulk = Math.round(
    bakeLogs.reduce((s, l) => s + l.bulkDurationMinutes, 0) / bakeLogs.length,
  );
  const goodBakes = bakeLogs.filter((l) => l.diagnosis === 'properly_fermented').length;

  return (
    <FlatList
      data={bakeLogs}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <BakeCard item={item} />}
      contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
      style={{ backgroundColor: C.bg }}
      ListHeaderComponent={
        <View style={{ marginBottom: 18 }}>
          <Text style={{ color: C.text, fontSize: 30, fontFamily: fonts.display, letterSpacing: 0.2 }}>
            Bake History
          </Text>
          <Text style={{ color: C.textMuted, fontSize: 14, marginTop: 4, marginBottom: 16 }}>
            {bakeLogs.length} bake{bakeLogs.length !== 1 ? 's' : ''} logged
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Stat value={String(bakeLogs.length)} caption="bakes" />
            <Stat value={formatDuration(avgBulk)} caption="avg bulk" />
            <Stat value={String(goodBakes)} caption="dialed in" />
          </View>
        </View>
      }
    />
  );
}
