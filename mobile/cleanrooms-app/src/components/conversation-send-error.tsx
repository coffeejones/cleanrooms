import { StyleSheet } from 'react-native';

import { colors } from '@/constants/palette';
import { PressFeedback } from './press-feedback';
import { Row, Txt } from './ui';

export function ConversationSendError({ error, onRetry, disabled }: {
  error: string;
  onRetry: () => void;
  disabled: boolean;
}) {
  return (
    <Row gap={8}>
      <Txt size={13} color={colors.danger} accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.message}>
        {error}
      </Txt>
      <PressFeedback
        accessibilityRole="button"
        accessibilityLabel="Prøv at sende beskeden igen"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onRetry}
        style={styles.retry}
      >
        <Txt size={13} weight="600" color={disabled ? colors.muted : colors.accent} selectable={false}>Prøv igen</Txt>
      </PressFeedback>
    </Row>
  );
}

const styles = StyleSheet.create({
  message: { flex: 1, minWidth: 0 },
  retry: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
});
