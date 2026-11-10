import * as Haptics from 'expo-haptics';
import { useIsFocused } from 'expo-router/react-navigation';
import { useEffect, useState, type Ref } from 'react';
import { Pressable, type PressableProps, type View } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useReduceMotionPreference } from './motion-preference';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressFeedback({ style, haptic = false, disabled, onPressIn, onPressOut, onPress, onHoverIn, onHoverOut, ref, ...props }: PressableProps & {
  haptic?: 'selection' | 'light' | false;
  ref?: Ref<View>;
}) {
  const focused = useIsFocused();
  const reduceMotion = useReduceMotionPreference();
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const scale = useSharedValue(1);
  const motion = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  useEffect(() => {
    cancelAnimation(scale);
    scale.set(1);
    return () => cancelAnimation(scale);
  }, [disabled, focused, reduceMotion, scale]);

  function animate(pressed: boolean) {
    if (disabled || reduceMotion || !focused) {
      cancelAnimation(scale);
      scale.set(1);
      return;
    }
    scale.set(withTiming(pressed ? .99 : 1, {
      duration: pressed ? 90 : 160,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.Never,
    }));
  }

  return (
    <AnimatedPressable
      {...props}
      ref={ref}
      disabled={disabled}
      style={[typeof style === 'function' ? style({ pressed: pressed && focused && !disabled, hovered: hovered && !disabled }) : style, motion]}
      onPressIn={event => { setPressed(true); animate(true); onPressIn?.(event); }}
      onPressOut={event => { setPressed(false); animate(false); onPressOut?.(event); }}
      onHoverIn={event => { setHovered(true); onHoverIn?.(event); }}
      onHoverOut={event => { setHovered(false); onHoverOut?.(event); }}
      onPress={event => {
        if (disabled) return;
        if (onPress && haptic && focused && process.env.EXPO_OS !== 'web') {
          // A completed tap gives feedback; scrolling past a row does not.
          void (haptic === 'selection' ? Haptics.selectionAsync() : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => {});
        }
        onPress?.(event);
      }}
    />
  );
}
