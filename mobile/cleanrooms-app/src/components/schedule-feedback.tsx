import { ActivityIndicator, Pressable } from 'react-native';
import { Row, Txt } from '@/components/ui';
import { colors } from '@/constants/palette';

export function ScheduleFeedback({ loading = false, loadingLabel = 'Henter vagter…', error, onRetry }: { loading?: boolean; loadingLabel?: string; error?: string; onRetry: () => void }) {
  if (!loading && !error) return null;
  return (
    <Row gap={10} style={{ paddingVertical: 12, paddingHorizontal: 14, flexWrap: 'wrap' }} accessibilityLiveRegion="polite">
      {loading && <ActivityIndicator color={colors.accent} />}
      <Txt size={13} color={colors.muted} style={{ flexShrink: 1 }}>{error ?? loadingLabel}</Txt>
      {error && <Pressable onPress={onRetry} accessibilityRole="button">
        <Txt size={13} color={colors.accent} weight="600" selectable={false}>Prøv igen</Txt>
      </Pressable>}
    </Row>
  );
}
