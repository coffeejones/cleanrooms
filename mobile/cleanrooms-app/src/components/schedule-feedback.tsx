import { ActivityIndicator, Pressable } from 'react-native';
import { Row, Txt } from '@/components/ui';
import { useMobileAuth } from '@/auth/mobile-auth';
import { colors } from '@/constants/palette';

export function ScheduleFeedback({ loading = false, loadingLabel = 'Henter vagter…', error, onRetry, offline = false, savedAt }: { loading?: boolean; loadingLabel?: string; error?: string; onRetry: () => void; offline?: boolean; savedAt?: number }) {
  const { state } = useMobileAuth();
  const showOffline = offline && state.mode === 'signedIn' && state.connection === 'offline';
  if (!loading && !error && !showOffline || offline && !showOffline && !error) return null;
  const lastUpdated = savedAt ? new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(savedAt) : '';
  const message = showOffline ? 'Offline' + (lastUpdated ? ' · opdateret ' + lastUpdated : '') : error ?? loadingLabel;
  return (
    <Row gap={10} style={{ paddingVertical: 12, paddingHorizontal: 14, flexWrap: 'wrap' }} accessibilityLiveRegion="polite">
      {loading && !offline && <ActivityIndicator color={colors.accent} />}
      <Txt size={13} color={colors.muted} style={{ flexShrink: 1 }}>{message}</Txt>
      {(error || showOffline) && <Pressable onPress={onRetry} accessibilityRole="button">
        <Txt size={13} color={colors.accent} weight="600" selectable={false}>Prøv igen</Txt>
      </Pressable>}
    </Row>
  );
}
