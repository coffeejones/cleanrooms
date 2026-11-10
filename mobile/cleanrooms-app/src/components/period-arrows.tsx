import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { StyleSheet, View } from 'react-native';
import { PressFeedback } from '@/components/press-feedback';
import { Icon } from '@/components/ui';
import { cardColors } from '@/constants/card-styles';
import { colors } from '@/constants/palette';

const hasGlass = process.env.EXPO_OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();

export function PeriodArrows({ previousLabel, nextLabel, onPrevious, onNext }: {
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const buttons = (
    <>
      <PeriodArrow label={previousLabel} direction="left" onPress={onPrevious} />
      <View style={styles.divider} />
      <PeriodArrow label={nextLabel} direction="right" onPress={onNext} />
    </>
  );

  return hasGlass ? (
    <GlassView
      glassEffectStyle="regular"
      colorScheme="light"
      tintColor="rgba(242, 246, 244, 0.24)"
      isInteractive
      style={styles.arrows}
    >
      {buttons}
    </GlassView>
  ) : (
    <View style={[styles.arrows, styles.fallback]}>{buttons}</View>
  );
}

function PeriodArrow({ label, direction, onPress }: { label: string; direction: 'left' | 'right'; onPress: () => void }) {
  return (
    <PressFeedback
      accessibilityRole="button"
      accessibilityLabel={label}
      haptic="selection"
      onPress={onPress}
      style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}
    >
      <Icon name={`chevron-${direction}`} size={17} />
    </PressFeedback>
  );
}

const styles = StyleSheet.create({
  arrows: { flexDirection: 'row', alignItems: 'center', borderRadius: 11, borderCurve: 'continuous' },
  fallback: { backgroundColor: colors.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: cardColors.border },
  arrow: { width: 44, height: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  divider: { width: StyleSheet.hairlineWidth, height: 16, backgroundColor: '#cbd5d1' },
  pressed: { backgroundColor: colors.paper },
});
