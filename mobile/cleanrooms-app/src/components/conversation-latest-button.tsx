import { StyleSheet } from 'react-native';

import { cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { useReduceMotionPreference } from './motion-preference';
import { PressFeedback } from './press-feedback';
import { Icon } from './ui';

export const latestMessageThreshold = 72;

export function ConversationLatestButton({ onJump }: { onJump: (animated: boolean) => void }) {
  const reduceMotion = useReduceMotionPreference();
  return (
    <PressFeedback
      accessibilityRole="button"
      accessibilityLabel="Gå til nyeste besked"
      haptic="light"
      onPress={() => onJump(!reduceMotion)}
      style={({ pressed }) => [cardStyles.raisedFrame, styles.button, pressed && styles.pressed]}
    >
      <Icon name="chevron-down" size={15} color={colors.ink} />
    </PressFeedback>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute', right: 16, bottom: 10,
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.paper },
});
