import { router, useIsFocused } from 'expo-router';
import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors } from '@/constants/palette';
import { useReduceMotionPreference } from './motion-preference';
import { PressFeedback } from './press-feedback';

const radius = 116;

type ShiftDetailsButtonProps = Omit<ComponentProps<typeof PressFeedback>, 'children' | 'onPress' | 'ref' | 'style'> & {
  shiftId: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function ShiftDetailsButton({ shiftId, children, style, disabled, onPressIn, ...props }: ShiftDetailsButtonProps) {
  const focused = useIsFocused();
  const reduceMotion = useReduceMotionPreference();
  const button = useRef<View>(null);
  const press = useRef(0);
  const origin = useSharedValue({ x: 0, y: 0 });
  const progress = useSharedValue(1);
  const ripple = useAnimatedStyle(() => {
    const { x, y } = origin.get();
    const phase = progress.get();
    return {
      opacity: .15 * (1 - phase),
      transform: [{ translateX: x - radius }, { translateY: y - radius }, { scale: .06 + .94 * phase }],
    };
  });

  useLayoutEffect(() => {
    // Let the outgoing ripple finish during the push and clear it before a return.
    if (focused || reduceMotion || disabled) progress.set(1);
    return () => { press.current += 1; };
  }, [disabled, focused, progress, reduceMotion, shiftId]);

  function startRipple(event: GestureResponderEvent) {
    onPressIn?.(event);
    if (reduceMotion || disabled || !focused) return;
    const id = ++press.current;
    const { pageX, pageY } = event.nativeEvent;
    // Touch coordinates may come from a child label. Measure the row in the same space.
    button.current?.measure((_x, _y, width, height, left, top) => {
      if (id !== press.current || width <= 0 || height <= 0) return;
      const x = pageX - left;
      const y = pageY - top;
      origin.set({
        x: x >= 0 && x <= width ? x : width / 2,
        y: y >= 0 && y <= height ? y : height / 2,
      });
      progress.set(0);
      progress.set(withTiming(1, { duration: 240, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System }));
    });
  }

  const { borderRadius, borderTopLeftRadius, borderTopRightRadius, borderBottomLeftRadius, borderBottomRightRadius, borderCurve } = StyleSheet.flatten(style) ?? {};

  return (
    <PressFeedback
      {...props}
      ref={button}
      disabled={disabled}
      style={style}
      onPressIn={startRipple}
      onPress={() => router.push({ pathname: '/shift/[id]', params: { id: shiftId } })}
    >
      <View pointerEvents="none" aria-hidden style={[styles.clip, { borderRadius, borderTopLeftRadius, borderTopRightRadius, borderBottomLeftRadius, borderBottomRightRadius, borderCurve }]}>
        <Animated.View style={[styles.ripple, ripple]} />
      </View>
      {children}
    </PressFeedback>
  );
}

const styles = StyleSheet.create({
  clip: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  ripple: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: radius * 2,
    height: radius * 2,
    borderRadius: radius,
    backgroundColor: colors.accent,
  },
});
