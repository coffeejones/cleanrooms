import { StyleSheet, View, type ViewProps } from 'react-native';
import { cardColors } from '@/constants/card-styles';
import { FlowBackground } from './flow-background';

export function FlowScreen({ children, backgroundTop = 0, style, ...props }: ViewProps & { backgroundTop?: number | null }) {
  return (
    <View {...props} style={[styles.screen, style]}>
      {backgroundTop !== null && <FlowBackground style={{ top: backgroundTop }} />}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cardColors.canvas, overflow: 'hidden' },
});
