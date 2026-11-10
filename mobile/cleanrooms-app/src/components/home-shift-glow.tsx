import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedProps, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { useReduceMotionPreference } from './motion-preference';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const padding = 9;
const glowLayers = [
  { length: 140, strokeWidth: 14, opacity: .025 },
  { length: 120, strokeWidth: 9, opacity: .045 },
  { length: 100, strokeWidth: 4.5, opacity: .065 },
  { length: 80, strokeWidth: 1, opacity: .13 },
];

function GlowStroke({ path, perimeter, phase, length, strokeWidth, opacity }: {
  path: string;
  perimeter: number;
  phase: SharedValue<number>;
  length: number;
  strokeWidth: number;
  opacity: number;
}) {
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: phase.get() + length / 2 }));

  return (
    <AnimatedPath
      d={path}
      fill="none"
      stroke="#559cdb"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeDasharray={[length, perimeter - length]}
      opacity={opacity}
      animatedProps={animatedProps}
    />
  );
}

export function HomeShiftGlow({ focused }: { focused: boolean }) {
  const reduceMotion = useReduceMotionPreference();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const phase = useSharedValue(0);
  const width = Math.max(0, size.width - 1);
  const height = Math.max(0, size.height - 1);
  const radius = Math.min(13.5, width / 2, height / 2);
  const perimeter = 2 * (width + height - 4 * radius) + 2 * Math.PI * radius;
  const visible = focused && foreground && !reduceMotion;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', status => setForeground(status === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    cancelAnimation(phase);
    phase.set(0);
    if (visible && perimeter > 0) {
      // The path runs clockwise; a positive dash offset moves the glow counterclockwise.
      phase.set(withRepeat(withTiming(perimeter, {
        duration: 26_000,
        easing: Easing.linear,
        reduceMotion: ReduceMotion.Never,
      }), -1, false, undefined, ReduceMotion.Never));
    }
    return () => cancelAnimation(phase);
  }, [perimeter, phase, visible]);

  const x = padding + .5;
  const y = padding + .5;
  const right = x + width;
  const bottom = y + height;
  const path = `M ${x + radius} ${y} H ${right - radius} A ${radius} ${radius} 0 0 1 ${right} ${y + radius} V ${bottom - radius} A ${radius} ${radius} 0 0 1 ${right - radius} ${bottom} H ${x + radius} A ${radius} ${radius} 0 0 1 ${x} ${bottom - radius} V ${y + radius} A ${radius} ${radius} 0 0 1 ${x + radius} ${y} Z`;

  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={({ nativeEvent: { layout } }) => setSize(previous => (
        previous.width === layout.width && previous.height === layout.height
          ? previous
          : { width: layout.width, height: layout.height }
      ))}
      style={styles.frame}
    >
      {visible && perimeter > glowLayers[0].length && (
        <Svg width={size.width + padding * 2} height={size.height + padding * 2} style={styles.canvas}>
          {glowLayers.map(layer => <GlowStroke key={layer.strokeWidth} {...layer} path={path} perimeter={perimeter} phase={phase} />)}
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', top: -1, left: -1, right: -1, bottom: -1 },
  canvas: { position: 'absolute', top: -padding, left: -padding },
});
