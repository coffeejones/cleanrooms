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

type Ribbon = { id: string; curve: string; band: string; opacity: number; fillOpacity: number };

const ribbons: Ribbon[] = [
  {
    id: 'home-flow-ripple',
    curve: 'M -40 104 C 24 148 80 148 146 114 S 286 52 440 98',
    band: 'M -40 104 C 24 148 80 148 146 114 S 286 52 440 98 L 440 106 C 286 60 212 90 146 122 C 80 158 24 156 -40 111 Z',
    opacity: .78, fillOpacity: .11,
  },
  {
    id: 'home-flow-bend',
    curve: 'M -40 80 C 58 38 120 130 214 137 S 350 126 440 58',
    band: 'M -40 80 C 58 38 120 130 214 137 S 350 126 440 58 L 440 64 C 350 133 308 153 214 145 C 120 138 58 44 -40 87 Z',
    opacity: .72, fillOpacity: .08,
  },
  {
    id: 'home-flow-sweep',
    curve: 'M -40 148 C 94 150 184 106 440 86',
    band: 'M -40 148 C 94 150 184 106 440 86 L 440 92 C 184 112 94 156 -40 153 Z',
    opacity: .62, fillOpacity: .06,
  },
];

function FlowRibbon({ ribbon }: { ribbon: Ribbon }) {
  const paint = `url(#${ribbon.id})`;
  return (
    <Svg width="100%" height="100%" viewBox="0 0 400 160" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={ribbon.id} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#77a7df" />
          <Stop offset="52%" stopColor="#8ec6e0" />
          <Stop offset="100%" stopColor="#70c8bb" />
        </LinearGradient>
      </Defs>
      <G opacity={ribbon.opacity}>
        <Path d={ribbon.band} fill={paint} opacity={ribbon.fillOpacity} />
        <Path d={ribbon.curve} fill="none" stroke={paint} strokeWidth={.65} opacity={.15} />
      </G>
    </Svg>
  );
}

function DriftingRibbon({ ribbon, active, reduceMotion, style }: {
  ribbon: Ribbon;
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

  return <Animated.View style={[style, motion]}><FlowRibbon ribbon={ribbon} /></Animated.View>;
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
      {ribbons.map(ribbon => (
        <DriftingRibbon key={ribbon.id} ribbon={ribbon} active={active} reduceMotion={reduceMotion} style={styles.lower} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  lower: { position: 'absolute', bottom: -8, left: -20, right: -20, height: 160 },
});
