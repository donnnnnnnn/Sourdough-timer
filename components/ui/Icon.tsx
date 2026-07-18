/**
 * Icon — the app's own glyph set, drawn in the fold-wheel style: 1.8px round
 * strokes on a 24-grid, honey-on-espresso. Replaces platform emoji (which
 * clash with the microscopy art and render differently per OS) and generic
 * icon-font glyphs in product surfaces.
 */
import Svg, { Circle, Path } from 'react-native-svg';
import { C } from '@/components/theme';

export type IconName =
  | 'loaf'
  | 'crumb'
  | 'jar'
  | 'fold'
  | 'thermometer'
  | 'clock'
  | 'flask'
  | 'camera'
  | 'shelf'
  | 'spark'
  | 'check'
  | 'alert'
  | 'flame'
  | 'share'
  | 'undo'
  | 'chevronRight'
  | 'close'
  | 'bubbles'
  | 'droop';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 18, color = C.textMuted, strokeWidth = 1.8 }: IconProps) {
  const p = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {name === 'loaf' && (
        <>
          <Path {...p} d="M3.5 17 C3.5 10.8 7.2 6.8 12 6.8 C16.8 6.8 20.5 10.8 20.5 17 Z" />
          <Path {...p} d="M9 10.2 C10.6 9.2 13.4 9.2 15 10.2" />
        </>
      )}
      {name === 'crumb' && (
        <>
          <Path {...p} d="M3.5 17 C3.5 10.8 7.2 6.8 12 6.8 C16.8 6.8 20.5 10.8 20.5 17 Z" />
          <Circle {...p} cx="9.2" cy="13.4" r="1.25" />
          <Circle {...p} cx="13.6" cy="11" r="1.05" />
          <Circle {...p} cx="15.6" cy="14.6" r="1.25" />
          <Circle {...p} cx="11.6" cy="15.2" r="0.8" />
        </>
      )}
      {name === 'jar' && (
        <>
          <Path {...p} d="M7 8.5 V17 a3 3 0 0 0 3 3 h4 a3 3 0 0 0 3-3 V8.5" />
          <Path {...p} d="M6.2 8.5 H17.8" />
          <Path {...p} d="M8.6 5 h6.8 a1.4 1.4 0 0 1 1.4 1.4 v2.1 H7.2 V6.4 A1.4 1.4 0 0 1 8.6 5 Z" />
          <Circle {...p} cx="10.6" cy="13.4" r="1" />
          <Circle {...p} cx="13.8" cy="16.2" r="1.2" />
        </>
      )}
      {name === 'fold' && (
        <>
          <Path {...p} d="M4 15.5 C7 8.5 11 8.5 12 12 C13 15.5 17 15.5 20 9.5" />
          <Path {...p} d="M17.6 9.2 L20 9.5 L19.7 11.9" />
        </>
      )}
      {name === 'thermometer' && (
        <>
          <Path {...p} d="M10.4 5.5 a1.6 1.6 0 0 1 3.2 0 V13" />
          <Circle {...p} cx="12" cy="16.4" r="3.3" />
          <Circle cx="12" cy="16.4" r="1.3" fill={color} />
        </>
      )}
      {name === 'clock' && (
        <>
          <Circle {...p} cx="12" cy="12" r="8" />
          <Path {...p} d="M12 7.6 V12 L15.3 13.9" />
        </>
      )}
      {name === 'flask' && (
        <>
          <Path {...p} d="M10 4.5 h4 M11 4.5 v4.2 L6.9 16.7 a2.1 2.1 0 0 0 2 2.8 h6.2 a2.1 2.1 0 0 0 2-2.8 L13 8.7 V4.5" />
          <Circle {...p} cx="12" cy="15.4" r="1.15" />
        </>
      )}
      {name === 'camera' && (
        <>
          <Path {...p} d="M4.5 9.6 a2 2 0 0 1 2-2 h2 L10 5.4 h4 l1.5 2.2 h2 a2 2 0 0 1 2 2 V17 a2 2 0 0 1 -2 2 h-11 a2 2 0 0 1 -2-2 Z" />
          <Circle {...p} cx="12" cy="13.2" r="3.1" />
        </>
      )}
      {name === 'shelf' && (
        <>
          <Path {...p} d="M4 16.5 H20" />
          <Path {...p} d="M5.6 16.5 V19.5 M18.4 16.5 V19.5" />
          <Path {...p} d="M8 16.5 C8 12.9 9.9 11.1 12 11.1 C14.1 11.1 16 12.9 16 16.5" />
        </>
      )}
      {name === 'spark' && (
        <Path {...p} d="M12 4.5 L13.5 10.5 L19.5 12 L13.5 13.5 L12 19.5 L10.5 13.5 L4.5 12 L10.5 10.5 Z" />
      )}
      {name === 'check' && <Path {...p} d="M5.5 12.8 L10 17.2 L18.5 7.6" />}
      {name === 'alert' && (
        <>
          <Path {...p} d="M12 4.8 L20 18.1 a1.5 1.5 0 0 1 -1.3 2.3 H5.3 A1.5 1.5 0 0 1 4 18.1 Z" />
          <Path {...p} d="M12 10.4 v4" />
          <Circle cx="12" cy="17.3" r="1" fill={color} />
        </>
      )}
      {name === 'flame' && (
        <>
          <Path {...p} d="M12 4.5 C15 8 17.4 10.4 17.4 13.9 a5.4 5.4 0 0 1 -10.8 0 C6.6 10.7 9.5 8 12 4.5 Z" />
          <Path {...p} d="M12 12.2 C13.2 13.4 13.9 14.2 13.9 15.3 a1.9 1.9 0 0 1 -3.8 0 C10.1 14.2 10.8 13.4 12 12.2 Z" />
        </>
      )}
      {name === 'share' && (
        <>
          <Path {...p} d="M12 14.2 V4.8 M8.6 8 L12 4.6 L15.4 8" />
          <Path {...p} d="M8.5 11.4 H6.8 a2 2 0 0 0 -2 2 v4.4 a2 2 0 0 0 2 2 h10.4 a2 2 0 0 0 2-2 v-4.4 a2 2 0 0 0 -2-2 h-1.7" />
        </>
      )}
      {name === 'undo' && (
        <>
          <Path {...p} d="M5 6.6 V11 h4.4" />
          <Path {...p} d="M5.4 11 A7 7 0 1 0 7.2 6.4" />
        </>
      )}
      {name === 'chevronRight' && <Path {...p} d="M9.5 6 L15.5 12 L9.5 18" />}
      {name === 'close' && <Path {...p} d="M7 7 L17 17 M17 7 L7 17" />}
      {name === 'bubbles' && (
        <>
          <Circle {...p} cx="8.6" cy="14.8" r="3.4" />
          <Circle {...p} cx="15.4" cy="9.6" r="2.4" />
          <Circle {...p} cx="16.8" cy="16.2" r="1.4" />
        </>
      )}
      {name === 'droop' && (
        <>
          <Path {...p} d="M3.5 17.5 C5.5 17.5 5.8 14.6 8 13 C10 11.6 14 11.6 16 13 C18.2 14.6 18.5 17.5 20.5 17.5" />
          <Path {...p} d="M3.5 17.5 H20.5" />
        </>
      )}
    </Svg>
  );
}
