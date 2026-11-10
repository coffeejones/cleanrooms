import { StyleSheet, View } from 'react-native';
import Svg, { Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';

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

export function HomeFlowBackground() {
  return (
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.frame}>
      <View style={styles.upper}>
        <FlowRibbon id="home-flow-upper" opacity={.75} />
      </View>
      <View style={styles.lower}>
        <FlowRibbon id="home-flow-lower" opacity={1} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  upper: { position: 'absolute', top: -45, left: 0, right: 0, height: 132 },
  lower: { position: 'absolute', bottom: -8, left: 0, right: 0, height: 160 },
});
