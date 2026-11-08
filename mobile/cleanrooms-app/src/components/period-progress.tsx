import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { PeriodSummary } from '@/domain/model';
import { colors } from '@/constants/palette';
import { Progress, Row, Txt } from './ui';

const moneyFormatter = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 });
const hoursFormatter = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 2 });

function moneyValue(cents: number) {
  return moneyFormatter.format(cents / 100);
}

function hoursValue(minutes: number) {
  return hoursFormatter.format(minutes / 60);
}

export function PeriodProgress({ summary, future, moneyUnavailable = false }: { summary: PeriodSummary; future: boolean; moneyUnavailable?: boolean }) {
  const { fontScale, width } = useWindowDimensions();
  const worked = hoursValue(summary.workedMinutes);
  const planned = hoursValue(summary.plannedMinutes);
  const metrics = [
    {
      title: future ? 'Planlagte timer' : 'Registrerede timer',
      value: future ? planned : worked,
      target: !future && summary.plannedMinutes > 0 ? planned : null,
      unit: 't',
    },
    {
      title: future ? 'Forventet før skat' : 'Optjent før skat',
      value: moneyUnavailable ? '—' : moneyValue(future ? summary.estimatedCents : summary.earnedCents),
      target: !moneyUnavailable && !future && summary.estimatedCents > 0 ? moneyValue(summary.estimatedCents) : null,
      unit: 'kr',
    },
  ];

  return (
    <View style={styles.summary}>
      <Row gap={16} style={[styles.metrics, (fontScale > 1.35 || width < 345) && styles.stacked]}>
        {metrics.map(metric => (
          <View key={metric.title} style={styles.metric}>
            <Txt size={12} weight="500" color={colors.muted}>{metric.title}</Txt>
            <Txt
              size={18}
              weight="600"
              style={styles.value}
              accessibilityLabel={metric.target
                ? `${metric.value} af ${metric.target} ${metric.unit}`
                : `${metric.value} ${metric.unit}`}
            >
              {metric.value}
              <Txt size={12} weight="500" color={colors.muted}>
                {metric.target ? ` / ${metric.target} ${metric.unit}` : ` ${metric.unit}`}
              </Txt>
            </Txt>
          </View>
        ))}
      </Row>
      {!future && summary.plannedMinutes > 0 && (
        <Progress value={summary.progress} label={worked + ' af ' + planned + ' timer afsluttet'} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { gap: 12 },
  metrics: { alignItems: 'flex-start' },
  stacked: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  metric: { flex: 1, minWidth: 0, gap: 4 },
  value: { letterSpacing: -.2 },
});
