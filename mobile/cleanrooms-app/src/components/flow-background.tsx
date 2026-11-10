import { useIsFocused } from 'expo-router/react-navigation';
import { useEffect, useId, useMemo, useState } from 'react';
import { AppState, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { useReduceMotionPreference } from './motion-preference';

type FlowLayer = {
  id: string;
  heights: readonly [number, number, number, number];
  spreads: readonly [number, number, number, number];
  strands: number; speed: number; start: number;
  lineOpacity: number; fillOpacity: number; strokeWidth: number;
};

const layers: FlowLayer[] = [
  {
    id: 'home-flow-silk', heights: [84, 130, 60, 106], spreads: [16, 17, 48, 24],
    strands: 20, speed: 10, start: 0,
    lineOpacity: .13, fillOpacity: .032, strokeWidth: .75,
  },
  {
    id: 'home-flow-mist', heights: [108, 138, 96, 118], spreads: [11, 12, 25, 17],
    strands: 12, speed: 7.5, start: .08,
    lineOpacity: .10, fillOpacity: .022, strokeWidth: .65,
  },
];

function flowCurve(layer: FlowLayer, fraction: number, period: number, reverse = false) {
  const p = (value: number) => Number(value.toFixed(3));
  const heights = layer.heights.map((height, index) => height + layer.spreads[index] * fraction);
  const heightAt = (index: number) => heights[(index + heights.length) % heights.length];
  const step = period / heights.length;
  let path = `M ${reverse ? p(period * 2) : 0} ${p(heights[0])}`;
  // A periodic spline keeps the fanned edges and their tangents continuous at every join.
  for (let segment = 0; segment < heights.length * 2; segment++) {
    const index = reverse ? heights.length * 2 - segment - 1 : segment;
    const x = index * step;
    const start = heightAt(index);
    const end = heightAt(index + 1);
    const c1 = start + (end - heightAt(index - 1)) / 6;
    const c2 = end - (heightAt(index + 2) - start) / 6;
    path += reverse
      ? ` C ${p(x + step * 2 / 3)} ${p(c2)} ${p(x + step / 3)} ${p(c1)} ${p(x)} ${p(start)}`
      : ` C ${p(x + step / 3)} ${p(c1)} ${p(x + step * 2 / 3)} ${p(c2)} ${p(x + step)} ${p(end)}`;
  }
  return path;
}

function TravellingRibbon({ layer, period, active, reduceMotion }: {
  layer: FlowLayer;
  period: number;
  active: boolean;
  reduceMotion: boolean;
}) {
  const gradientId = `${layer.id}-${useId().replace(/:/g, '')}`;
  const phase = useSharedValue(period * layer.start);
  const motion = useAnimatedStyle(() => ({ transform: [{ translateX: -(phase.get() % period) }] }));
  const paths = useMemo(() => {
    const curve = (fraction: number, reverse = false) => flowCurve(layer, fraction, period, reverse);
    return {
      band: `${curve(-1)} ${curve(1, true).replace(/^M /, 'L ')} Z`,
      strands: Array.from({ length: layer.strands }, (_, index) => ({
        path: curve((index + .5) / layer.strands * 2 - 1),
        opacity: layer.lineOpacity * (.4 + .6 * Math.sin(Math.PI * (index + .5) / layer.strands)),
      })),
    };
  }, [layer, period]);

  useEffect(() => {
    cancelAnimation(phase);
    if (active && !reduceMotion) {
      const origin = phase.get() % period;
      phase.set(origin);
      phase.set(withRepeat(withTiming(origin + period, {
        duration: period / layer.speed * 1_000,
        easing: Easing.linear,
        reduceMotion: ReduceMotion.Never,
      }), -1, false, undefined, ReduceMotion.Never));
    }
    return () => cancelAnimation(phase);
  }, [active, layer.speed, period, phase, reduceMotion]);

  const paint = `url(#${gradientId})`;
  return (
    <Animated.View style={[styles.lower, { width: period * 2 }, motion]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${period * 2} 160`} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor="#77a7df" />
            <Stop offset="25%" stopColor="#70c8bb" />
            <Stop offset="50%" stopColor="#77a7df" />
            <Stop offset="75%" stopColor="#70c8bb" />
            <Stop offset="100%" stopColor="#77a7df" />
          </LinearGradient>
        </Defs>
        <Path d={paths.band} fill={paint} opacity={layer.fillOpacity} />
        {paths.strands.map((strand, index) => (
          <Path key={index} d={strand.path} fill="none" stroke={paint} strokeWidth={layer.strokeWidth} opacity={strand.opacity} />
        ))}
      </Svg>
    </Animated.View>
  );
}

export function FlowBackground({ style }: { style?: StyleProp<ViewStyle> }) {
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const period = Math.max(width * 2, 640);
  const reduceMotion = useReduceMotionPreference();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', status => setForeground(status === 'active'));
    return () => subscription.remove();
  }, []);
  const active = focused && foreground;

  return (
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.frame, style]}>
      {layers.map(layer => (
        <TravellingRibbon key={layer.id} layer={layer} period={period} active={active} reduceMotion={reduceMotion} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  lower: { position: 'absolute', bottom: -8, left: 0, height: 160 },
});
