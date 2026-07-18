import { Tabs } from 'expo-router';
import { Timer, BookOpen } from 'lucide-react-native';
import { C } from '@/components/theme';

// Headers are off: every screen draws its own in-page title, so the stock
// navigation bar was just repeating it and spending ~100px. Screens handle
// their own top safe-area padding instead.
export default function TabLayout() {
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
        options={{
          title: 'Bake',
          tabBarIcon: ({ color, size }) => <Timer color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="log"
        options={{
          title: 'Shelf',
          tabBarIcon: ({ color, size }) => <BookOpen color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
