import { router, useIsFocused, useNavigationContainerRef } from 'expo-router';
import { findFocusedRoute } from 'expo-router/react-navigation';
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { colors } from '@/constants/palette';
import { useReduceMotionPreference } from './motion-preference';
import { PressFeedback } from './press-feedback';

export function ShiftDetailsButton({ shiftId, children, ...props }: Omit<ComponentProps<typeof PressFeedback>, 'children' | 'onPress'> & {
  shiftId: string;
  children: ReactNode;
}) {
  const navigation = useNavigationContainerRef();
  const focused = useIsFocused();
  const reduceMotion = useReduceMotionPreference();
  const stopWatching = useRef<(() => void) | null>(null);
  const opacity = useSharedValue(0);
  const highlight = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  useEffect(() => {
    opacity.set(0);
    return () => {
      stopWatching.current?.();
      stopWatching.current = null;
      cancelAnimation(opacity);
    };
  }, [opacity, reduceMotion, shiftId]);

  useEffect(() => {
    if (!focused) {
      cancelAnimation(opacity);
      opacity.set(0);
    }
  }, [focused, opacity]);

  function openDetails() {
    stopWatching.current?.();
    stopWatching.current = null;
    cancelAnimation(opacity);
    opacity.set(0);

    const sourceKey = !reduceMotion && focused && navigation.isReady()
      ? findFocusedRoute(navigation.getRootState())?.key
      : undefined;
    if (sourceKey) {
      let detailKey: string | undefined;
      const unsubscribe = navigation.addListener('state', () => {
        const route = findFocusedRoute(navigation.getRootState());
        if (!route?.key) return;

        const matchesShift = route.name === 'shift/[id]' && route.params && 'id' in route.params && route.params.id === shiftId;
        if (!detailKey && route.key === sourceKey) return;
        if (matchesShift && (!detailKey || route.key === detailKey)) {
          detailKey = route.key;
          return;
        }

        // Consume the highlight on the first navigation away from these details.
        unsubscribe();
        stopWatching.current = null;
        if (!detailKey || route.key !== sourceKey) return;

        opacity.set(1);
        opacity.set(withDelay(230, withTiming(0, {
          duration: 520,
          easing: Easing.inOut(Easing.quad),
          reduceMotion: ReduceMotion.System,
        }), ReduceMotion.System));
      });
      stopWatching.current = unsubscribe;
    }

    router.push({ pathname: '/shift/[id]', params: { id: shiftId } });
  }

  return (
    <PressFeedback {...props} onPress={openDetails}>
      <Animated.View pointerEvents="none" aria-hidden style={[styles.highlight, highlight]} />
      {children}
    </PressFeedback>
  );
}

const styles = StyleSheet.create({
  highlight: {
    position: 'absolute',
    top: 1,
    bottom: 1,
    left: 4,
    right: 4,
    borderRadius: 8,
    backgroundColor: colors.accentSoft,
  },
});
