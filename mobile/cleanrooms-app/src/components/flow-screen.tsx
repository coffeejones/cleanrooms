import { Image } from 'expo-image';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { cardColors } from '@/constants/card-styles';

const background = require('../../assets/images/screen-background.webp');

export function FlowScreen({ children, style, ...props }: ViewProps) {
  return (
    <View {...props} style={[styles.screen, style]}>
      <View pointerEvents="none" aria-hidden style={StyleSheet.absoluteFill}>
        <Image source={background} contentFit="fill" cachePolicy="memory" style={StyleSheet.absoluteFill} />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cardColors.canvas, overflow: 'hidden' },
});
