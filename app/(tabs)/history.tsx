import { View, Text, FlatList } from 'react-native';
import { useBakeStore, BakeLog } from '@/store/useBakeStore';

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

const CRUMB_EMOJI: Record<string, string> = {
  Classical: '🌾',
  Honeycomb: '🍯',
  Molten: '💧',
  'Fools Crumb': '⚠️',
};

const SHAPE_EMOJI: Record<string, string> = {
  'Full Body': '🏆',
  'Sloping Shoulders': '📐',
  Spreading: '🥞',
};

function BakeCard({ item }: { item: BakeLog }) {
  return (
    <View
      style={{
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e7e5e4',
        borderRadius: 20,
        padding: 20,
        marginBottom: 12,
      }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#a8a29e', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            {formatDate(item.timestamp)}
          </Text>
          <Text style={{ color: '#1c1917', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 }}>
            {formatDuration(item.bulkDurationMinutes)}
          </Text>
          <Text style={{ color: '#78716c', fontSize: 15, marginTop: 2 }}>
            {item.foldCount} fold{item.foldCount !== 1 ? 's' : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <View style={{ backgroundColor: '#f5f5f4', borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 16 }}>{CRUMB_EMOJI[item.crumbType] ?? '🍞'}</Text>
            <Text style={{ color: '#44403c', fontSize: 13, fontWeight: '600' }}>{item.crumbType}</Text>
          </View>
          <View style={{ backgroundColor: '#f5f5f4', borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 16 }}>{SHAPE_EMOJI[item.shapeType] ?? '🍞'}</Text>
            <Text style={{ color: '#44403c', fontSize: 13, fontWeight: '600' }}>{item.shapeType}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

export default function HistoryScreen() {
  const { bakeLogs } = useBakeStore();

  if (bakeLogs.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fafaf9', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ fontSize: 64 }}>📖</Text>
        <Text style={{ color: '#1c1917', fontSize: 24, fontWeight: '700', textAlign: 'center', marginTop: 16, marginBottom: 8 }}>
          No bakes logged yet
        </Text>
        <Text style={{ color: '#a8a29e', fontSize: 16, textAlign: 'center' }}>
          Complete your first bulk fermentation and log the results to build your history.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={bakeLogs}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <BakeCard item={item} />}
      contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
      style={{ backgroundColor: '#fafaf9' }}
      ListHeaderComponent={
        <View style={{ marginBottom: 16 }}>
          <Text style={{ color: '#1c1917', fontSize: 28, fontWeight: '800' }}>
            Bake History
          </Text>
          <Text style={{ color: '#a8a29e', fontSize: 15, marginTop: 4 }}>
            {bakeLogs.length} bake{bakeLogs.length !== 1 ? 's' : ''} logged
          </Text>
        </View>
      }
    />
  );
}
