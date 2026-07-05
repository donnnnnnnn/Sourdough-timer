import '../global.css';

import { Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';

import { initFoldAlarms } from '@/lib/foldAlarm';

SplashScreen.preventAutoHideAsync();

// Show notifications as banners with sound even when the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Fold-alarm setup ("I folded" action + tap handler) — at module scope so
// notification presses are handled even when the app was in the background.
// See lib/foldAlarm.ts.
initFoldAlarms();

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
    // Android 8+ requires a channel before any notification can play sound.
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('bake-alerts', {
        name: 'Bake Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 300, 200, 300],
        lightColor: '#E8A33D',
        sound: 'default',
      });
    }
  }, []);

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
