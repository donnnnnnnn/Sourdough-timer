import '../global.css';

import { Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';

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

// A fold reminder carries an "I folded" action so the persistent alarm can be
// silenced straight from the notification (recording the fold cancels the rest
// of the repeating alerts). Registered once at startup.
Notifications.setNotificationCategoryAsync('fold-reminder', [
  {
    identifier: 'FOLDED',
    buttonTitle: 'I folded ✓',
    options: { opensAppToForeground: true },
  },
]).catch(() => {});

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
