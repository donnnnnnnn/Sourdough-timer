import { Tabs } from 'expo-router';
import { Timer, BookOpen, History, ScanLine } from 'lucide-react-native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#F59E0B',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.35)',
        tabBarStyle: {
          backgroundColor: 'rgba(24,24,27,0.92)',
          borderTopColor: 'rgba(255,255,255,0.06)',
          borderTopWidth: 0.5,
          paddingTop: 4,
        },
        headerStyle: {
          backgroundColor: '#0c0c0f',
        },
        headerTintColor: '#e4e4e7',
        headerTitleStyle: { fontWeight: '600', fontSize: 17, letterSpacing: 0.3 },
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
          title: 'Log Bake',
          tabBarIcon: ({ color, size }) => <BookOpen color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => <History color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="diagnose"
        options={{
          title: 'Diagnose',
          tabBarIcon: ({ color, size }) => <ScanLine color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
