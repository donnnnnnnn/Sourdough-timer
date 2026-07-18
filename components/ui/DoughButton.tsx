/**
 * DoughButton — the Tier-1 action shape: a soft asymmetric "proofing boule"
 * that squishes like dough when pressed. One per screen region, by design.
 * Honey is reserved for actions tied to the living process (starting bulk);
 * cream is the milestone/positive variant; soft is the in-progress variant.
 */
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { C, doughRadii } from '@/components/theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { Squish } from './Squish';

interface DoughButtonProps {
  label: string;
  sub?: string;
  icon?: IconName;
  onPress: () => void;
  onLongPress?: () => void;
  variant?: 'honey' | 'cream' | 'soft' | 'quiet';
  size?: 'lg' | 'md';
  disabled?: boolean;
  glow?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  children?: React.ReactNode;
}

export function DoughButton({
  label,
  sub,
  icon,
  onPress,
  onLongPress,
  variant = 'honey',
  size = 'lg',
  disabled,
  glow = variant === 'honey',
  style,
  accessibilityLabel,
  accessibilityHint,
  children,
}: DoughButtonProps) {
  const bg =
    variant === 'honey' ? C.accent : variant === 'cream' ? C.cream : variant === 'soft' ? C.accentSoft : C.parchment2;
  const fg =
    variant === 'honey' ? C.onAccent : variant === 'cream' ? C.onCream : variant === 'soft' ? C.accent : C.text;
  return (
    <Squish
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      dough
      haptic="medium"
      pressScale={0.965}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      style={[
        {
          backgroundColor: bg,
          ...doughRadii(size === 'lg' ? 1 : 0.7),
          paddingVertical: size === 'lg' ? 24 : 16,
          paddingHorizontal: 24,
          alignItems: 'center',
          justifyContent: 'center',
          ...(variant === 'soft' ? { borderWidth: 1.5, borderColor: C.accentBorder } : null),
          ...(glow && !disabled
            ? {
                shadowColor: C.accent,
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.35,
                shadowRadius: 24,
                elevation: 8,
              }
            : null),
        },
        style,
      ]}>
      {children ?? (
        <View style={{ alignItems: 'center', flexDirection: icon ? 'row' : 'column', gap: icon ? 10 : 2 }}>
          {icon && <Icon name={icon} size={size === 'lg' ? 21 : 17} color={fg} strokeWidth={2} />}
          <AppText
            role="title"
            color={fg}
            style={{ fontSize: size === 'lg' ? 24 : 17, fontWeight: '800', letterSpacing: -0.3 }}>
            {label}
          </AppText>
          {sub ? (
            <AppText role="caption" color={variant === 'honey' || variant === 'cream' ? 'rgba(28,18,8,0.6)' : C.textDim}>
              {sub}
            </AppText>
          ) : null}
        </View>
      )}
    </Squish>
  );
}
