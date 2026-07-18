/**
 * EmptyState — empty moments teach and invite; they never apologize.
 */
import { View } from 'react-native';
import { C } from '@/components/theme';
import { AppText } from './AppText';
import { DoughButton } from './DoughButton';
import { Icon, type IconName } from './Icon';

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon = 'shelf', title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 36, paddingHorizontal: 12, gap: 6 }}>
      <View
        style={{
          width: 84,
          height: 84,
          borderRadius: 30,
          backgroundColor: C.parchment,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 10,
        }}>
        <Icon name={icon} size={40} color={C.straw} strokeWidth={1.4} />
      </View>
      <AppText role="display" center style={{ fontSize: 22 }}>
        {title}
      </AppText>
      <AppText role="body" center color={C.textMuted} style={{ maxWidth: 300 }}>
        {body}
      </AppText>
      {actionLabel && onAction ? (
        <DoughButton label={actionLabel} onPress={onAction} variant="cream" size="md" style={{ marginTop: 18, minWidth: 200 }} />
      ) : null}
    </View>
  );
}
