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

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  useEffect(() => {
    // Fold-alarm setup ("I folded" action + tap handler). Deliberately NOT at
    // module scope: a synchronous throw there ran before React mounted and
    // crashed the app on launch ("undefined is not a function") — `.catch()`
    // on a promise can't intercept a sync throw. Here the native runtime is
    // fully up, and initFoldAlarms() itself traps every failure internally.
    // A notification tap that *launched* the app is still handled — see the
    // getLastNotificationResponse() recovery inside initFoldAlarms().
    initFoldAlarms();
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
