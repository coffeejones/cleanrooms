import { useIsFocused } from 'expo-router/react-navigation';
import { useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { useReduceMotionPreference } from './motion-preference';

type FlowLayer = {
  id: string; base: number; amplitude: number; skew: number; strands: number;
  strandSpacing: number; speed: number; start: number;
  lineOpacity: number; fillOpacity: number; strokeWidth: number;
};

const layers: FlowLayer[] = [
  {
    id: 'home-flow-silk', base: 88, amplitude: 42, skew: -10, strands: 12,
    strandSpacing: 1.7, speed: 10, start: 0,
    lineOpacity: .14, fillOpacity: .04, strokeWidth: .75,
  },
  {
    id: 'home-flow-mist', base: 128, amplitude: 24, skew: -5, strands: 10,
    strandSpacing: 1.9, speed: 7.5, start: .08,
    lineOpacity: .115, fillOpacity: .025, strokeWidth: .65,
  },
];

function flowCurve(base: number, amplitude: number, skew: number, period: number, reverse = false) {
  const p = (value: number) => Number(value.toFixed(3));
  let path = `M ${reverse ? p(period * 2) : 0} ${p(base)}`;
  // Each period has matching endpoint heights and tangents for seamless travel.
  for (const tile of reverse ? [1, 0] : [0, 1]) {
    const x = tile * period;
    if (reverse) {
      path += ` C ${p(x + period * .88)} ${p(base - amplitude)} ${p(x + period * .65)} ${p(base - amplitude + skew)} ${p(x + period * .5)} ${p(base + skew)}`;
      path += ` C ${p(x + period * .35)} ${p(base + amplitude + skew)} ${p(x + period * .12)} ${p(base + amplitude)} ${p(x)} ${p(base)}`;
    } else {
      path += ` C ${p(x + period * .12)} ${p(base + amplitude)} ${p(x + period * .35)} ${p(base + amplitude + skew)} ${p(x + period * .5)} ${p(base + skew)}`;
      path += ` C ${p(x + period * .65)} ${p(base - amplitude + skew)} ${p(x + period * .88)} ${p(base - amplitude)} ${p(x + period)} ${p(base)}`;
    }
  }
  return path;
}

function TravellingRibbon({ layer, period, active, reduceMotion }: {
  layer: FlowLayer;
  period: number;
  active: boolean;
  reduceMotion: boolean;
}) {
  const phase = useSharedValue(period * layer.start);
  const motion = useAnimatedStyle(() => ({ transform: [{ translateX: -(phase.get() % period) }] }));
  const paths = useMemo(() => {
    const curve = (offset: number, reverse = false) => flowCurve(
      layer.base + offset * layer.strandSpacing,
      layer.amplitude + offset * .35,
      layer.skew + offset * .08,
      period,
      reverse,
    );
    const edge = (layer.strands - 1) / 2 + 1.5;
    return {
      band: `${curve(-edge)} ${curve(edge, true).replace(/^M /, 'L ')} Z`,
      strands: Array.from({ length: layer.strands }, (_, index) => ({
        path: curve(index - (layer.strands - 1) / 2),
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

  const paint = `url(#${layer.id})`;
  return (
    <Animated.View style={[styles.lower, { width: period * 2 }, motion]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${period * 2} 160`} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={layer.id} x1="0%" y1="0%" x2="100%" y2="0%">
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

export function HomeFlowBackground({ style }: { style?: StyleProp<ViewStyle> }) {
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
