import { Button as NativeButton, Host, Text as NativeText } from '@expo/ui';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, View, useWindowDimensions, type TextProps, type TextStyle, type ViewProps, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/constants/palette';
import { buttonContentModifiers } from './button-content-shape';
import { PressFeedback } from './press-feedback';

export function Txt({ size = 15, weight = '400', color = colors.ink, style, ...props }: TextProps & { size?: number; weight?: TextStyle['fontWeight']; color?: string }) {
  return <Text selectable {...props} style={[{ fontSize: size, fontWeight: weight, color, lineHeight: size * 1.4, fontVariant: ['tabular-nums'] }, style]} />;
}
const paths: Record<string, string> = {
  home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  calendar: 'M8 2v4m8-4v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 9h2m4 0h2m-8 4h2m4 0h2',
  clock: 'M12 7v5l3 2', check: 'm5 12 4 4L19 6',
  'chevron-left': 'm14 6-6 6 6 6', 'chevron-right': 'm10 6 6 6-6 6', 'chevron-down': 'm6 9 6 6 6-6',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12a2 2 0 0 0 4 0',
  chat: 'M21 11.5a9 9 0 0 1-9 9 9.5 9.5 0 0 1-4-.9L3 21l1.4-4.8a9 9 0 1 1 16.6-4.7ZM8 11h.01M12 11h.01M16 11h.01',
  settings: 'm9 3-.5 3-2.6 1L3 6l-1 4 2.5 2-.5 3-2 2 3 3 3-1 2 1 1 3h4l1-3 2-1 3 1 2-3-2-2-.5-3L22 10l-1-4-3 1-2.5-1L15 3Z',
  'arrow-up-right': 'M7 17 17 7M7 7h10v10', plus: 'M12 5v14M5 12h14',
  user: 'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M13 3.1a4 4 0 0 1 0 7.8M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  'map-pin': 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  'arrow-right': 'M4 12h16m-6-6 6 6-6 6', 'arrow-left': 'M20 12H4m6-6-6 6 6 6',
  pause: 'M8 5v14M16 5v14', play: 'm8 4 12 8-12 8Z', 'check-circle': 'm8 12 3 3 5-6',
  send: 'm22 2-7 20-4-9L2 9Zm0 0L11 13', x: 'm6 6 12 12M6 18 18 6', search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  file: 'M14 2H5v20h14V7Zm0 0v6h5M8 12h8m-8 4h6', moon: 'M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z',
  info: 'M12 11v6m0-10v.01', wallet: 'M3 6h16v15H3V5a2 2 0 0 1 2-2h13v3m1 6h-6v5h6',
};
const sf: Record<string, string> = { home: 'house', calendar: 'calendar', clock: 'clock', check: 'checkmark', 'check-circle': 'checkmark.circle', 'chevron-left': 'chevron.left', 'chevron-right': 'chevron.right', 'chevron-down': 'chevron.down', bell: 'bell', chat: 'bubble.left.and.bubble.right', settings: 'gearshape', 'arrow-up-right': 'arrow.up.right', plus: 'plus', user: 'person', users: 'person.2', 'map-pin': 'mappin.and.ellipse', 'arrow-right': 'arrow.right', 'arrow-left': 'arrow.left', pause: 'pause', play: 'play', send: 'paperplane', x: 'xmark', search: 'magnifyingglass', file: 'doc.text', moon: 'moon', info: 'info.circle', wallet: 'creditcard' };
export function Icon({ name, size = 20, color = colors.ink }: { name: string; size?: number; color?: string }) {
  if (process.env.EXPO_OS === 'ios' && sf[name]) return <Image source={`sf:${sf[name]}`} tintColor={color} style={{ width: size, height: size }} accessibilityElementsHidden />;
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {['clock', 'check-circle', 'info'].includes(name) && <Circle cx={12} cy={12} r={9} />}
    {name === 'settings' && <Circle cx={12} cy={12} r={3} />}
    {name === 'calendar' && <Rect x={0} y={0} width={0} height={0} />}
    <Path d={paths[name] || paths.info} />
  </Svg>;
}
export function Row({ gap = 12, style, ...props }: ViewProps & { gap?: number }) { return <View {...props} style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]} />; }
export const surfaceStyle = { backgroundColor: colors.surface, borderRadius: 14, borderCurve: 'continuous', padding: 16 } satisfies ViewStyle;
export function Surface({ style, ...props }: ViewProps) { return <View {...props} style={[surfaceStyle, style]} />; }
export function Button({ label, onPress, variant = 'primary', disabled, style, compact }: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; icon?: string; style?: ViewStyle; compact?: boolean }) {
  const [controlWidth, setControlWidth] = useState<number>();
  const { fontScale } = useWindowDimensions();
  const height = Math.max(compact ? 44 : 48, Math.ceil(21 * fontScale) + 20);
  const filled = variant === 'primary' || variant === 'danger';
  const outlined = variant === 'secondary';
  const background = filled ? variant === 'danger' ? colors.danger : colors.accent : outlined ? colors.white : 'transparent';
  const innerWidth = controlWidth === undefined ? undefined : Math.max(0, controlWidth - (outlined ? 2 : 0));
  const innerHeight = height - (outlined ? 2 : 0);
  return <View onLayout={({ nativeEvent }) => setControlWidth(nativeEvent.layout.width)} style={[{
    minHeight: height, opacity: disabled ? 0.45 : 1,
    borderRadius: 10, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: background,
    borderWidth: outlined ? 1 : 0, borderColor: '#9aa8a5',
  }, style]}>
    <Host matchContents={{ vertical: true }} style={{ width: '100%' }} colorScheme="light" seedColor={variant === 'danger' ? colors.danger : variant === 'primary' ? colors.accent : colors.ink}>
      <NativeButton
        disabled={disabled}
        onPress={() => {
          void Haptics.selectionAsync().catch(() => {});
          onPress();
        }}
        variant="text"
        style={{
          height: innerHeight,
          // SwiftUI's frame needs a measured width rather than a percentage.
          width: innerWidth,
          backgroundColor: background,
        }}
      >
        <NativeText
          style={{ width: innerWidth, height: innerHeight }}
          modifiers={buttonContentModifiers}
          textStyle={{ color: filled ? colors.white : colors.ink, fontSize: process.env.EXPO_OS === 'ios' ? 15 * fontScale : 15, fontWeight: '600', textAlign: 'center' }}
        >{label}</NativeText>
      </NativeButton>
    </Host>
  </View>;
}
export function IconButton({ name, label, onPress, badge, style }: { name: string; label: string; onPress: () => void; badge?: boolean; style?: ViewStyle }) {
  return <PressFeedback haptic="light" onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4} style={({ pressed }) => [{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, opacity: pressed ? .5 : 1 }, style]}>
    <Icon name={name} />{badge && <View style={{ position: 'absolute', right: 9, top: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger, borderWidth: 1.5, borderColor: colors.white }} />}
  </PressFeedback>;
}
export function Progress({ value, color = colors.accent, label = 'Registrerede timer' }: { value: number; color?: string; label?: string }) {
  const v = Math.max(0, Math.min(1, value || 0));
  return <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }} style={{ height: 4, backgroundColor: colors.line, borderRadius: 2, overflow: 'hidden' }}><View style={{ width: `${v * 100}%`, height: '100%', backgroundColor: color, borderRadius: 2 }} /></View>;
}
export function EmptyState({ title, body, icon = 'calendar', compact = false }: { title: string; body?: string; icon?: string; compact?: boolean }) {
  return <View style={{
    minHeight: compact ? 56 : undefined,
    paddingVertical: compact ? 10 : 32, paddingHorizontal: compact ? 14 : 24,
    flexDirection: compact ? 'row' : 'column', alignItems: 'center', gap: compact ? 12 : 14,
  }}>
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{
      width: compact ? 28 : 48, height: compact ? 28 : 48,
      borderRadius: compact ? 9 : 16, borderCurve: 'continuous',
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line,
    }}>
      <Icon name={icon} color={colors.muted} size={compact ? 16 : 23} />
    </View>
    <View style={{ flex: compact ? 1 : undefined, minWidth: 0, maxWidth: compact ? undefined : 280, gap: compact ? 3 : 5 }}>
      <Txt size={compact ? 14 : 15} weight={compact ? '500' : '600'} style={{ textAlign: compact ? 'left' : 'center', letterSpacing: -.15 }}>{title}</Txt>
      {!!body && <Txt size={compact ? 12 : 13} color={colors.muted} style={{ textAlign: compact ? 'left' : 'center', lineHeight: compact ? 18 : 20 }}>{body}</Txt>}
    </View>
  </View>;
}
export function Avatar({ initials, size = 36, dark = false }: { initials: string; size?: number; dark?: boolean }) { return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark ? colors.ink : '#e8edeb', alignItems: 'center', justifyContent: 'center' }}><Txt size={size * .33} weight="600" color={dark ? colors.white : colors.text}>{initials}</Txt></View>; }
export function LiveClock({ size = 17, color = colors.accent }: { size?: number; color?: string }) {
  const [turn] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let animation: Animated.CompositeAnimation | undefined;
    const update = (reduce: boolean) => { animation?.stop(); if (!reduce) { turn.setValue(0); animation = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 60000, easing: Easing.linear, useNativeDriver: process.env.EXPO_OS !== 'web' })); animation.start(); } };
    void AccessibilityInfo.isReduceMotionEnabled().then(update);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', update);
    return () => { sub.remove(); animation?.stop(); };
  }, [turn]);
  return <View aria-hidden style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.4, borderColor: color }}><Animated.View style={{ position: 'absolute', inset: 0, transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}><View style={{ position: 'absolute', width: 1.3, height: size * .3, left: size / 2 - 2, top: 2, borderRadius: 1, backgroundColor: color }} /></Animated.View><View style={{ position: 'absolute', width: size * .22, height: 1.3, left: size / 2 - 1, top: size / 2 - 1.5, backgroundColor: color, transform: [{ rotate: '30deg' }] }} /></View>;
}
export function FadeIn({ children }: { children: ReactNode }) {
  const [reduce, setReduce] = useState(true);
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => { void AccessibilityInfo.isReduceMotionEnabled().then(setReduce); const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce); return () => sub.remove(); }, []);
  useEffect(() => { if (!reduce) { opacity.setValue(.5); Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: process.env.EXPO_OS !== 'web' }).start(); } }, [reduce, opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}
