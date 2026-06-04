import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import {
  Layers,
  Grid2x2,
  Droplets,
  AlertTriangle,
  ArrowUp,
  TrendingDown,
  Minus,
} from 'lucide-react-native';
import { useBakeStore, CrumbType, ShapeType } from '@/store/useBakeStore';

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

const CRUMB_OPTIONS: { type: CrumbType; label: string; description: string; Icon: React.FC<{ color: string; size: number }> }[] = [
  { type: 'Classical', label: 'Classical Artisan', description: 'Varied mix of large & small holes', Icon: Layers },
  { type: 'Honeycomb', label: 'Honeycomb', description: 'Regular, even matrix of holes', Icon: Grid2x2 },
  { type: 'Molten', label: 'Molten', description: 'Extreme openness, translucent crumb', Icon: Droplets },
  { type: 'Fools Crumb', label: "Fool's Crumb", description: 'Dense base with cavernous tunnels', Icon: AlertTriangle },
];

const SHAPE_OPTIONS: { type: ShapeType; label: string; description: string; Icon: React.FC<{ color: string; size: number }> }[] = [
  { type: 'Full Body', label: 'Full Body', description: 'Tall and proud with a defined ear', Icon: ArrowUp },
  { type: 'Sloping Shoulders', label: 'Sloping Shoulders', description: 'Tall center, flattens at the heels', Icon: TrendingDown },
  { type: 'Spreading', label: 'Spreading / Pancake', description: 'Flat, lacking structural tension', Icon: Minus },
];

export default function LogScreen() {
  const { lastBulkDurationMinutes, lastFoldCount, saveLog } = useBakeStore();
  const [selectedCrumb, setSelectedCrumb] = useState<CrumbType | null>(null);
  const [selectedShape, setSelectedShape] = useState<ShapeType | null>(null);

  const hasPending = lastBulkDurationMinutes !== null;

  function handleSubmit() {
    if (!selectedCrumb || !selectedShape) {
      Alert.alert('Select both', 'Please select a crumb type and a shape before saving.');
      return;
    }
    saveLog(selectedCrumb, selectedShape);
    router.push('/');
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
          style={{
            backgroundColor: C.accent,
            borderRadius: 18,
            paddingVertical: 16,
            paddingHorizontal: 36,
          }}>
          <Text style={{ color: '#0c0c0f', fontSize: 16, fontWeight: '700' }}>
            Go to Timer
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>

      <Text style={{ color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.3, marginBottom: 4 }}>
        Log Your Bake
      </Text>
      <Text style={{ color: C.textMuted, fontSize: 15, marginBottom: 24 }}>
        How did it turn out?
      </Text>

      <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 14 }}>
        Crumb Structure
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 28 }}>
        {CRUMB_OPTIONS.map(({ type, label, description, Icon }) => {
          const active = selectedCrumb === type;
          return (
            <TouchableOpacity
              key={type}
              onPress={() => setSelectedCrumb(type)}
              activeOpacity={0.7}
              style={{
                width: '48%',
                backgroundColor: active ? C.accentSoft : C.card,
                borderWidth: 1.5,
                borderColor: active ? C.accent : C.cardBorder,
                borderRadius: 18,
                padding: 18,
                alignItems: 'center',
              }}>
              <Icon color={active ? C.accent : C.textMuted} size={30} />
              <Text
                style={{
                  color: active ? C.accent : C.text,
                  fontSize: 14,
                  fontWeight: '700',
                  textAlign: 'center',
                  marginTop: 10,
                  marginBottom: 4,
                }}>
                {label}
              </Text>
              <Text
                style={{
                  color: active ? 'rgba(245,158,11,0.65)' : C.textDim,
                  fontSize: 11,
                  textAlign: 'center',
                  lineHeight: 15,
                }}>
                {description}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 14 }}>
        Loaf Shape
      </Text>
      <View style={{ gap: 10, marginBottom: 32 }}>
        {SHAPE_OPTIONS.map(({ type, label, description, Icon }) => {
          const active = selectedShape === type;
          return (
            <TouchableOpacity
              key={type}
              onPress={() => setSelectedShape(type)}
              activeOpacity={0.7}
              style={{
                backgroundColor: active ? C.accentSoft : C.card,
                borderWidth: 1.5,
                borderColor: active ? C.accent : C.cardBorder,
                borderRadius: 18,
                padding: 18,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 16,
              }}>
              <Icon color={active ? C.accent : C.textMuted} size={26} />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: active ? C.accent : C.text,
                    fontSize: 15,
                    fontWeight: '700',
                    marginBottom: 2,
                  }}>
                  {label}
                </Text>
                <Text style={{ color: active ? 'rgba(245,158,11,0.65)' : C.textDim, fontSize: 12 }}>
                  {description}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity
        onPress={handleSubmit}
        activeOpacity={0.8}
        style={{
          backgroundColor: selectedCrumb && selectedShape ? C.accent : 'rgba(255,255,255,0.08)',
          borderRadius: 20,
          paddingVertical: 20,
          alignItems: 'center',
          shadowColor: selectedCrumb && selectedShape ? C.accent : 'transparent',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.3,
          shadowRadius: 20,
        }}>
        <Text style={{
          color: selectedCrumb && selectedShape ? '#0c0c0f' : C.textDim,
          fontSize: 18,
          fontWeight: '800',
        }}>
          Save Bake Log
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
