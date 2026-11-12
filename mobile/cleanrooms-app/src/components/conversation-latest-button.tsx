import { StyleSheet, View } from 'react-native';

import { cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { useReduceMotionPreference } from './motion-preference';
import { PressFeedback } from './press-feedback';
import { Icon } from './ui';

export const latestMessageThreshold = 72;

export function ConversationLatestButton({ onJump, hasNewMessages = false }: {
  onJump: (animated: boolean) => void;
  hasNewMessages?: boolean;
}) {
  const reduceMotion = useReduceMotionPreference();
  return (
    <PressFeedback
      accessibilityRole="button"
      accessibilityLabel={hasNewMessages ? 'Nye beskeder. Gå til nyeste besked' : 'Gå til nyeste besked'}
      haptic="light"
      onPress={() => onJump(!reduceMotion)}
      style={({ pressed }) => [cardStyles.raisedFrame, styles.button, pressed && styles.pressed]}
    >
      <Icon name="chevron-down" size={15} color={colors.ink} />
      {hasNewMessages && <View aria-hidden pointerEvents="none" style={styles.dot} />}
    </PressFeedback>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute', right: 16, bottom: 10,
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  dot: {
    position: 'absolute', top: 4, right: 4,
    width: 9, height: 9, borderRadius: 5, borderWidth: 1, borderColor: colors.white,
    backgroundColor: colors.accent,
  },
  pressed: { backgroundColor: colors.paper },
});
