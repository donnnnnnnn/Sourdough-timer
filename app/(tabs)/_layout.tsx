import { Tabs } from 'expo-router';
import { Timer, BookOpen, History } from 'lucide-react-native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#b5521e',
        tabBarInactiveTintColor: '#78716c',
        tabBarStyle: {
          backgroundColor: '#fafaf9',
          borderTopColor: '#e7e5e4',
        },
        headerStyle: { backgroundColor: '#fafaf9' },
        headerTintColor: '#1c1917',
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
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
    </Tabs>
  );
}
