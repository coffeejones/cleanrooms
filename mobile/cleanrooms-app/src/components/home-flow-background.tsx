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
  'M -40 28 C 90 140 250 132 440 -10',
  'M -40 43 C 104 143 252 139 440 14',
  'M -40 58 C 108 140 253 136 440 38',
  'M -40 68 C 110 115 250 112 440 49',
  'M -40 84 C 100 137 245 134 440 80',
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
        <Path d="M -40 28 C 90 140 250 132 440 -10 L 440 28 C 250 160 88 158 -40 57 Z" fill={paint} opacity={.11} />
        <Path d="M -40 66 C 110 115 250 112 440 49 L 440 80 C 245 134 100 137 -40 84 Z" fill={paint} opacity={.08} />
        <Path d="M -40 74 C 90 166 246 177 440 57 L 440 89 C 254 185 94 175 -40 98 Z" fill={paint} opacity={.05} />
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
        driftSteps(0, 6, 16_000), driftSteps(0, 3.5, 18_000),
        driftSteps(1.02, .012, 22_000), driftSteps(1, .022, 20_000),
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

export function HomeFlowBackground() {
  const focused = useIsFocused();
  const reduceMotion = useReduceMotionPreference();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', status => setForeground(status === 'active'));
    return () => subscription.remove();
  }, []);
  const active = focused && foreground;

  return (
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.frame}>
      <DriftingRibbon id="home-flow-upper" opacity={.55} active={active} reduceMotion={reduceMotion} style={styles.upper} />
      <DriftingRibbon id="home-flow-lower" opacity={.78} active={active} reduceMotion={reduceMotion} style={styles.lower} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  upper: { position: 'absolute', top: -45, left: -14, right: -14, height: 132 },
  lower: { position: 'absolute', bottom: -8, left: -14, right: -14, height: 160 },
});
