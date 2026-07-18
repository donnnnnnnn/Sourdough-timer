/**
 * AppText — role-based text. Every string in the app renders through one of
 * these roles so the 7-step scale stays a system, not a suggestion.
 */
import { Text, type TextProps, type TextStyle } from 'react-native';
import { typeScale, label as labelStyle } from '@/components/theme';

export type TextRole =
  | 'hero'
  | 'stat'
  | 'displayLg'
  | 'display'
  | 'title'
  | 'emphasis'
  | 'body'
  | 'caption'
  | 'label';

interface AppTextProps extends Omit<TextProps, 'role'> {
  role?: TextRole;
  color?: string;
  center?: boolean;
}

export function AppText({ role = 'body', color, center, style, children, ...rest }: AppTextProps) {
  const base: TextStyle = role === 'label' ? (labelStyle as TextStyle) : typeScale[role];
  const isHeading = role === 'displayLg' || role === 'display';
  return (
    <Text
      accessibilityRole={isHeading ? 'header' : undefined}
      {...rest}
      style={[base, color ? { color } : null, center ? { textAlign: 'center' } : null, style]}>
      {children}
    </Text>
  );
}
