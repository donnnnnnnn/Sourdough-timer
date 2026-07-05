import { Tabs } from 'expo-router';
import { Timer, BookOpen } from 'lucide-react-native';
import { C, fonts } from '@/components/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.textDim,
        tabBarStyle: {
          backgroundColor: C.tabBar,
          borderTopColor: C.cardBorder,
          borderTopWidth: 0.5,
          paddingTop: 4,
        },
        tabBarLabelStyle: { fontWeight: '600', fontSize: 11 },
        headerStyle: {
          backgroundColor: C.bg,
        },
        headerTintColor: C.text,
        headerTitleStyle: { fontFamily: fonts.display, fontSize: 19, letterSpacing: 0.3 },
        headerShadowVisible: false,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Bulk Timer',
          tabBarIcon: ({ color, size }) => <Timer color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="log"
        options={{
          title: 'Bake Log',
          tabBarIcon: ({ color, size }) => <BookOpen color={color} size={size} />,
        }}
      />
      <Tabs.Screen name="diagnose" options={{ href: null }} />
    </Tabs>
  );
}
