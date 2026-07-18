import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Timer, BookOpen } from 'lucide-react-native';
import { C } from '@/components/theme';

/**
 * Native platforms get NativeTabs — the platform's real tab bar: the floating
 * Liquid Glass capsule on iOS 26+, the classic bar on older iOS, Material 3
 * tabs on Android (plan §4.6; on-device check in docs/launch-checklist.md).
 * Web keeps a classic styled bottom bar: NativeTabs' web rendering floats a
 * pill over the content, which collides with in-page titles.
 * Headers are off everywhere; screens draw their own titles + safe areas.
 */
export default function TabLayout() {
  if (Platform.OS === 'web') {
    return (
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: C.accent,
          tabBarInactiveTintColor: C.textDim,
          tabBarStyle: {
            backgroundColor: C.tabBar,
            borderTopColor: C.cardBorder,
            borderTopWidth: 0.5,
            paddingTop: 4,
          },
          tabBarLabelStyle: { fontWeight: '600', fontSize: 11 },
        }}>
        <Tabs.Screen
          name="index"
          options={{ title: 'Bake', tabBarIcon: ({ color, size }) => <Timer color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="log"
          options={{ title: 'Shelf', tabBarIcon: ({ color, size }) => <BookOpen color={color} size={size} /> }}
        />
      </Tabs>
    );
  }

  return (
    <NativeTabs
      labelStyle={{ color: C.textMuted }}
      tintColor={C.accent}
      iconColor={C.textMuted}
      backgroundColor={C.tabBar}
      indicatorColor={C.accentSoft}
      rippleColor={C.accentSoft}
      minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Bake</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="timer" md="schedule" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="log">
        <NativeTabs.Trigger.Label>Shelf</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="books.vertical.fill" md="menu_book" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
