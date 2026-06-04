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
      <View className="flex-1 bg-stone-50 items-center justify-center" style={{ padding: 32 }}>
        <Text style={{ fontSize: 64 }}>🍞</Text>
        <Text className="text-stone-800 text-2xl font-bold text-center mt-4 mb-2">
          No bake in progress
        </Text>
        <Text className="text-stone-400 text-base text-center mb-8">
          Complete a bulk fermentation first, then come back here to log your results.
        </Text>
        <TouchableOpacity
          onPress={() => router.push('/')}
          style={{
            backgroundColor: '#b5521e',
            borderRadius: 20,
            paddingVertical: 18,
            paddingHorizontal: 40,
          }}>
          <Text style={{ color: '#ffffff', fontSize: 18, fontWeight: '700' }}>
            Go to Timer
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-stone-50"
      contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>

      <Text className="text-stone-800 text-3xl font-bold mb-1">Log Your Bake</Text>
      <Text className="text-stone-400 text-base mb-6">
        How did it turn out?
      </Text>

      <Text className="text-stone-500 text-xs font-semibold uppercase tracking-widest mb-3">
        Crumb Structure
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        {CRUMB_OPTIONS.map(({ type, label, description, Icon }) => {
          const active = selectedCrumb === type;
          return (
            <TouchableOpacity
              key={type}
              onPress={() => setSelectedCrumb(type)}
              style={{
                width: '47%',
                backgroundColor: active ? '#b5521e' : '#ffffff',
                borderWidth: 2,
                borderColor: active ? '#b5521e' : '#e7e5e4',
                borderRadius: 16,
                padding: 18,
                alignItems: 'center',
              }}>
              <Icon color={active ? '#ffffff' : '#78716c'} size={32} />
              <Text
                style={{
                  color: active ? '#ffffff' : '#1c1917',
                  fontSize: 15,
                  fontWeight: '700',
                  textAlign: 'center',
                  marginTop: 10,
                  marginBottom: 4,
                }}>
                {label}
              </Text>
              <Text
                style={{
                  color: active ? '#fde8d8' : '#a8a29e',
                  fontSize: 12,
                  textAlign: 'center',
                }}>
                {description}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text className="text-stone-500 text-xs font-semibold uppercase tracking-widest mb-3">
        Loaf Shape
      </Text>
      <View style={{ gap: 10, marginBottom: 32 }}>
        {SHAPE_OPTIONS.map(({ type, label, description, Icon }) => {
          const active = selectedShape === type;
          return (
            <TouchableOpacity
              key={type}
              onPress={() => setSelectedShape(type)}
              style={{
                backgroundColor: active ? '#b5521e' : '#ffffff',
                borderWidth: 2,
                borderColor: active ? '#b5521e' : '#e7e5e4',
                borderRadius: 16,
                padding: 18,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 16,
              }}>
              <Icon color={active ? '#ffffff' : '#78716c'} size={28} />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: active ? '#ffffff' : '#1c1917',
                    fontSize: 16,
                    fontWeight: '700',
                    marginBottom: 2,
                  }}>
                  {label}
                </Text>
                <Text style={{ color: active ? '#fde8d8' : '#a8a29e', fontSize: 13 }}>
                  {description}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity
        onPress={handleSubmit}
        style={{
          backgroundColor: selectedCrumb && selectedShape ? '#b5521e' : '#d6d3d1',
          borderRadius: 20,
          paddingVertical: 22,
          alignItems: 'center',
        }}>
        <Text style={{ color: '#ffffff', fontSize: 20, fontWeight: '700' }}>
          Save Bake Log
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
