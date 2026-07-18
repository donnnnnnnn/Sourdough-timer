/**
 * Sheet — the app's one dialog surface: a parchment panel rising over a
 * dimmed espresso field. Replaces every Alert.alert and hand-rolled overlay
 * so all interruptions share one voice and one motion.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { C, motion, radius } from '@/components/theme';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { Squish } from './Squish';

interface SheetProps {
  visible: boolean;
  onClose?: () => void;
  title?: string;
  children: ReactNode;
}

export function Sheet({ visible, onClose, title, children }: SheetProps) {
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      fade.setValue(0);
      rise.setValue(0);
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(rise, { toValue: 1, ...motion.release, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, fade, rise]);

  if (!visible) return null;

  return (
    <Animated.View
      accessibilityViewIsModal
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        backgroundColor: 'rgba(18,14,12,0.88)',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: fade,
        zIndex: 20,
        padding: 28,
      }}>
      {onClose && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={onClose}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
        />
      )}
      <Animated.View
        style={{
          backgroundColor: C.parchment,
          borderRadius: radius.sheet,
          padding: 24,
          width: '100%',
          maxWidth: 380,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.5,
          shadowRadius: 30,
          elevation: 12,
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }],
        }}>
        {(title || onClose) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: title ? 12 : 0 }}>
            {title ? (
              <AppText role="title" style={{ flex: 1 }}>
                {title}
              </AppText>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            {onClose && (
              <Squish onPress={onClose} accessibilityLabel="Close" hitSlop={10} style={{ padding: 4 }}>
                <Icon name="close" size={17} color={C.textDim} />
              </Squish>
            )}
          </View>
        )}
        {children}
      </Animated.View>
    </Animated.View>
  );
}
