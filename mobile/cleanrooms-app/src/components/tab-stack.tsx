import { Stack } from 'expo-router';
import { useNavigationState, useRoute } from 'expo-router/react-navigation';
import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { HeaderActions } from '@/components/header-actions';
import { useReduceMotionPreference } from '@/components/motion-preference';
import { cardColors } from '@/constants/card-styles';
import { colors } from '@/constants/palette';

export default function TabStack({ name, title }: { name: string; title: string }) {
  const { key } = useRoute();
  // Watch tab selection so returning from a detail route doesn't replay the fade.
  const selected = useNavigationState((state) => state.routes[state.index]?.key === key);
  const reduceMotion = useReduceMotionPreference();
  const previouslySelected = useRef(false);
  const opacity = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  useLayoutEffect(() => {
    const switchedToTab = selected && !previouslySelected.current;
    previouslySelected.current = selected;
    if (!selected || reduceMotion) {
      opacity.set(1);
    } else if (switchedToTab) {
      opacity.set(0.82);
      opacity.set(withTiming(1, { duration: 110, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.Never }));
    }
  }, [opacity, reduceMotion, selected]);

  const screenLayout = useCallback(({ children }: { children: ReactNode }) => (
    <Animated.View style={[{ flex: 1 }, animatedStyle]}>{children}</Animated.View>
  ), [animatedStyle]);

  return <Stack screenLayout={screenLayout} screenOptions={{ headerStyle: { backgroundColor: cardColors.canvas }, headerTintColor: colors.ink, headerTitleStyle: { fontSize: 22, fontWeight: '700' }, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal', headerRight: () => <HeaderActions />, contentStyle: { backgroundColor: cardColors.canvas }, headerTitleAlign: 'left' }}><Stack.Screen name={name} options={{ title }} /></Stack>;
}
