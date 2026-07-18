/**
 * Chip — Tier-2 capsule selection. Selection reads as fill + honey ring (a
 * state change of the surface), never a hairline border swap.
 */
import { View } from 'react-native';
import { C } from '@/components/theme';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { Squish } from './Squish';

interface ChipProps {
  label: string;
  sub?: string;
  icon?: IconName;
  selected?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  /** Stretch to fill its row slot (for equal-width chip rows). */
  grow?: boolean;
  size?: 'md' | 'lg';
}

export function Chip({ label, sub, icon, selected = false, onPress, accessibilityLabel, grow, size = 'md' }: ChipProps) {
  return (
    <Squish
      onPress={onPress}
      pressScale={0.94}
      accessibilityLabel={accessibilityLabel ?? `${label}${sub ? `, ${sub}` : ''}${selected ? ', selected' : ''}`}
      style={[
        {
          backgroundColor: selected ? C.accentSoft : C.parchment2,
          borderRadius: 999,
          paddingVertical: size === 'lg' ? 16 : 11,
          paddingHorizontal: size === 'lg' ? 22 : 18,
          borderWidth: 1.5,
          borderColor: selected ? C.accent : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 7,
          minHeight: 44,
        },
        grow ? { flex: 1 } : null,
      ]}>
      {icon && <Icon name={icon} size={15} color={selected ? C.accent : C.textMuted} />}
      <View style={{ alignItems: 'center' }}>
        <AppText role="emphasis" color={selected ? C.accent : C.text} style={{ fontSize: size === 'lg' ? 17 : 15 }}>
          {label}
        </AppText>
        {sub ? (
          <AppText role="caption" color={selected ? 'rgba(232,163,61,0.75)' : C.textDim}>
            {sub}
          </AppText>
        ) : null}
      </View>
    </Squish>
  );
}
