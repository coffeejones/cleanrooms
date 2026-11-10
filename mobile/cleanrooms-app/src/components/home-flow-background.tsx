import { useIsFocused } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { useReduceMotionPreference } from './motion-preference';

type DriftStep = { target: number; duration: number };

function driftSteps(center: number, range: number, minimumDuration: number): DriftStep[] {
  return Array.from({ length: 5 }, () => ({
    target: center + (Math.random() * 2 - 1) * range,
    duration: minimumDuration + Math.random() * 12_000,
  }));
}

const contours = [
  'M -40 10 C 90 112 250 112 440 -10',
  'M -40 26 C 104 126 252 126 440 10',
  'M -40 42 C 108 139 253 139 440 30',
  'M -40 58 C 110 151 250 151 440 50',
  'M -40 74 C 100 163 245 163 440 70',
];

function FlowRibbon({ id, opacity }: { id: string; opacity: number }) {
  const paint = `url(#${id})`;
  return (
    <Svg width="100%" height="100%" viewBox="0 0 400 160" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={id} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#77a7df" />
          <Stop offset="52%" stopColor="#8ec6e0" />
          <Stop offset="100%" stopColor="#70c8bb" />
        </LinearGradient>
      </Defs>
      <G opacity={opacity}>
        <Path d="M -40 10 C 90 112 250 112 440 -10 L 440 -1 C 250 121 90 121 -40 19 Z" fill={paint} opacity={.11} />
        <Path d="M -40 42 C 108 139 253 139 440 30 L 440 39 C 253 148 108 148 -40 51 Z" fill={paint} opacity={.08} />
        <Path d="M -40 74 C 100 163 245 163 440 70 L 440 79 C 245 172 100 172 -40 83 Z" fill={paint} opacity={.05} />
        {contours.map(path => <Path key={path} d={path} fill="none" stroke={paint} strokeWidth={.65} opacity={.15} />)}
      </G>
    </Svg>
  );
}

function DriftingRibbon({ id, opacity, active, reduceMotion, style }: {
  id: string;
  opacity: number;
  active: boolean;
  reduceMotion: boolean;
  style: StyleProp<ViewStyle>;
}) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const scaleX = useSharedValue(1.02);
  const scaleY = useSharedValue(1);
  const plan = useRef<DriftStep[][] | null>(null);
  const motion = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.get() }, { translateY: y.get() },
      { scaleX: scaleX.get() }, { scaleY: scaleY.get() },
    ],
  }));

  useEffect(() => {
    const values = [x, y, scaleX, scaleY];
    const stop = () => values.forEach(value => cancelAnimation(value));
    stop();
    if (reduceMotion) {
      x.set(0);
      y.set(0);
      scaleX.set(1.02);
      scaleY.set(1);
    } else if (active) {
      // Generate once per layer, independently of the home screen's clock ticks.
      const layerPlans = plan.current ??= [
        driftSteps(0, 9, 16_000), driftSteps(0, 5, 18_000),
        driftSteps(1.02, .018, 22_000), driftSteps(1, .035, 20_000),
      ];
      const timing = { easing: Easing.inOut(Easing.sin), reduceMotion: ReduceMotion.Never };
      values.forEach((value, index) => {
        const origin = value.get();
        const steps = layerPlans[index];
        const sequence = steps.map(step => withTiming(step.target, { ...timing, duration: step.duration }));
        // Return to this run's origin so repetition and focus resumes stay seamless.
        sequence.push(withTiming(origin, { ...timing, duration: steps[0].duration }));
        value.set(withRepeat(withSequence(ReduceMotion.Never, ...sequence), -1, false, undefined, ReduceMotion.Never));
      });
    }
    return stop;
  }, [active, reduceMotion, scaleX, scaleY, x, y]);

  return <Animated.View style={[style, motion]}><FlowRibbon id={id} opacity={opacity} /></Animated.View>;
}

export function HomeFlowBackground({ style }: { style?: StyleProp<ViewStyle> }) {
  const focused = useIsFocused();
  const reduceMotion = useReduceMotionPreference();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', status => setForeground(status === 'active'));
    return () => subscription.remove();
  }, []);
  const active = focused && foreground;

  return (
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.frame, style]}>
      <DriftingRibbon id="home-flow-lower" opacity={.78} active={active} reduceMotion={reduceMotion} style={styles.lower} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  lower: { position: 'absolute', bottom: -8, left: -20, right: -20, height: 160 },
});
