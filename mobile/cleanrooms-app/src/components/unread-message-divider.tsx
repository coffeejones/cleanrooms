import { StyleSheet, Text, View } from 'react-native';

import { cardColors } from '@/constants/card-styles';
import { colors } from '@/constants/palette';

export function UnreadMessageDivider() {
  return (
    <View style={styles.divider}>
      <View style={styles.line} />
      <Text accessibilityRole="header" style={styles.label}>Nye beskeder</Text>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: cardColors.border },
  label: { color: colors.accent, fontSize: 12, fontWeight: '600' },
});
