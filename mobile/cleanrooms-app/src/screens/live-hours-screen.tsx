import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { FlowScreen } from '@/components/flow-screen';
import { PeriodArrows } from '@/components/period-arrows';
import { PeriodPicker } from '@/components/period-picker';
import { PeriodProgress } from '@/components/period-progress';
import { ScheduleFeedback } from '@/components/schedule-feedback';
import { EmptyState, Icon, Row, Txt } from '@/components/ui';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { clockTimeLabel, copenhagenDate, currency, dateLabel, minutesLabel, payPeriod } from '@/domain/model';
import { useEmployeeCompanySettings, useEmployeeHours, type EmployeeHoursRow } from '@/state/employee-data';
import { useNow } from '@/state/app-store';

export default function LiveHoursScreen() {
  const company = useEmployeeCompanySettings();
  if (!company.data) return (
    <FlowScreen>
      <ScrollView style={styles.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <ScheduleFeedback loading={company.loading} loadingLabel="Henter lønperiode…" error={company.error} onRetry={company.refresh} />
      </ScrollView>
    </FlowScreen>
  );
  return <CompanyHoursScreen startDay={company.data.payrollPeriod.startDay} companyError={company.error} refreshCompany={company.refresh} companyRefreshing={company.refreshing} />;
}

function CompanyHoursScreen({ startDay, companyError, refreshCompany, companyRefreshing }: { startDay: number; companyError?: string; refreshCompany: () => void; companyRefreshing: boolean }) {
  const [offset, setOffset] = useState(0);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [picker, setPicker] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [all, setAll] = useState(false);
  const today = copenhagenDate(useNow());
  const period = custom ?? payPeriod(today, offset, startDay);
  const hours = useEmployeeHours(period.from, period.to);
  const data = hours.data;
  const future = period.from > today;
  const rows = [...(data?.rows ?? [])].sort((a, b) => {
    const rank = (row: EmployeeHoursRow) => row.entry?.status === 'running' || row.entry?.status === 'paused' ? 0 : row.entry?.clockOut ? 1 : 2;
    const group = rank(a) - rank(b);
    const date = rank(a) === 1 ? b.shift.date.localeCompare(a.shift.date) : a.shift.date.localeCompare(b.shift.date);
    return group || date || a.shift.start.localeCompare(b.shift.start);
  });
  const change = (delta: number) => { setCustom(null); setOffset(value => custom ? delta : value + delta); setAll(false); };
  const label = `${dateLabel(period.from)} – ${dateLabel(period.to, { year: 'numeric' })}`;
  return <>
    <FlowScreen>
      <FlatList
        data={all ? rows : rows.slice(0, 4)} keyExtractor={row => row.shift.id}
        contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false}
        style={styles.screen} contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={hours.refreshing || companyRefreshing} onRefresh={() => { refreshCompany(); hours.refresh(); }} />}
        ListHeaderComponent={<>
          {companyError && <ScheduleFeedback error={companyError} onRetry={refreshCompany} />}
          <View style={cardStyles.listSurface}>
            <Row gap={8} style={styles.period}>
              <Pressable accessibilityRole="button" accessibilityLabel={'Vælg periode, ' + label} onPress={() => setPicker(true)} style={styles.periodButton}>
                <Txt size={12} weight="600" color={colors.muted}>{custom ? 'Valgt periode' : 'Lønperiode'}</Txt>
                <Row gap={5}><Txt size={15} weight="600" style={{ flexShrink: 1 }}>{label}</Txt><Icon name="chevron-down" size={11} color={colors.muted} /></Row>
              </Pressable>
              <PeriodArrows previousLabel="Forrige lønperiode" nextLabel="Næste lønperiode" onPrevious={() => change(-1)} onNext={() => change(1)} />
            </Row>
            {(offset !== 0 || custom) && <Pressable accessibilityRole="button" onPress={() => { setCustom(null); setOffset(0); }} style={styles.reset}><Txt size={13} weight="600" color={colors.accent}>Denne lønperiode</Txt></Pressable>}
            <ScheduleFeedback loading={hours.loading && !data} loadingLabel="Henter timer…" error={hours.error} onRetry={hours.refresh} />
            {data && <>
              <View style={styles.summary}>
                <PeriodProgress summary={data.summary} future={future} moneyUnavailable={(future ? data.summary.missingEstimatedPayCount : data.summary.missingEarnedPayCount) > 0} />
                {data.summary.monthlyCents > 0 && <Row style={{ justifyContent: 'space-between', marginTop: 14 }}><Txt size={12} color={colors.muted}>Fast løn i perioden</Txt><Txt size={14} weight="600">{currency(data.summary.monthlyCents)}</Txt></Row>}
                {data.warnings.map((warning, i) => <Txt key={i} size={12} color={colors.muted} style={{ marginTop: 8 }}>{warning}</Txt>)}
              </View>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.calculation}>
                <Row><Txt size={13} weight="600" style={{ flex: 1 }}>Lønberegning</Txt><Txt size={12} color={colors.muted}>{minutesLabel(data.summary.approvedMinutes)} godkendt</Txt><Icon name={expanded ? 'chevron-left' : 'chevron-down'} size={12} color={colors.muted} /></Row>
              </Pressable>
              {expanded && <View style={[styles.summary, { gap: 9 }]}>
                <Amount label="Grundløn" cents={future ? data.summary.baseEstimatedCents : data.summary.baseEarnedCents} />
                <Amount label="Tillæg" cents={future ? data.summary.allowanceEstimatedCents : data.summary.allowanceEarnedCents} />
                {data.monthlyLines.map((line, i) => <Amount key={i} label={line.label} cents={line.amountCents} />)}
              </View>}
            </>}
          </View>
          {rows.length > 0 && <Row style={styles.listTitle}><Txt size={15} weight="600" style={{ flex: 1 }}>Vagter i perioden <Txt size={12} color={colors.muted}>{rows.length}</Txt></Txt><Txt size={12} color={colors.muted}>Før skat</Txt></Row>}
        </>}
        ListEmptyComponent={data && !hours.error ? <View style={{ marginTop: 16 }}><EmptyState title="Ingen vagter i perioden" /></View> : null}
        ListFooterComponent={rows.length > 4 ? <Pressable accessibilityRole="button" onPress={() => setAll(value => !value)} style={styles.more}><Txt size={13} weight="600" color={colors.accent}>{all ? 'Vis færre vagter' : `Vis alle ${rows.length} vagter`}</Txt></Pressable> : null}
        renderItem={({ item }) => <LiveHourRow row={item} />}
      />
    </FlowScreen>
    <PeriodPicker visible={picker} from={period.from} to={period.to} onApply={(from, to) => { setCustom({ from, to }); setAll(false); }} onDismiss={() => setPicker(false)} />
  </>;
}

function Amount({ label, cents }: { label: string; cents: number }) {
  return <Row style={{ justifyContent: 'space-between' }}><Txt size={13} color={colors.muted} style={{ flex: 1 }}>{label}</Txt><Txt size={14} weight="500">{currency(cents)}</Txt></Row>;
}
function LiveHourRow({ row: { shift, site, entry, pay, sourceLabel } }: { row: EmployeeHoursRow }) {
  const registeredStart = pay.kind === 'registered' && pay.interval ? Date.parse(pay.interval.startAt) : NaN;
  const registeredEnd = pay.kind === 'registered' && pay.interval ? Date.parse(pay.interval.endAt) : NaN;
  const registeredInterval = Number.isFinite(registeredStart) && Number.isFinite(registeredEnd) && registeredEnd > registeredStart;
  const rowDate = registeredInterval ? copenhagenDate(registeredStart) : shift.date;
  const rowTime = registeredInterval ? `${clockTimeLabel(registeredStart)}–${clockTimeLabel(registeredEnd)}` : `${shift.start}–${shift.end}`;
  const status = entry?.status === 'approved' ? 'Godkendt' : entry?.status === 'running' ? 'I gang' : entry?.status === 'paused' ? 'På pause' : entry?.status === 'rejected' ? 'Sendt retur' : entry?.clockOut ? 'Til godkendelse' : 'Planlagt';
  return <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/shift/[id]', params: { id: shift.id } })} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.paper }]}>
    <View style={styles.day}><Txt size={18} weight="700">{Number(rowDate.slice(-2))}.</Txt><Txt size={11} color={colors.muted}>{dateLabel(rowDate, { day: undefined, month: 'short' })}</Txt></View>
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Txt size={15} weight="600">{rowTime}</Txt><Txt size={13} color={colors.muted} numberOfLines={2}>{site.name}</Txt><Txt size={11} color={colors.muted}>{status}</Txt></View>
    <View style={{ alignItems: 'flex-end', maxWidth: '42%', gap: 2 }}><Txt size={15} weight="600">{pay.unavailableReason ? '—' : currency(pay.totalCents)}</Txt><Txt size={12} color={colors.muted}>{pay.kind === 'registered' ? minutesLabel(pay.minutes) : 'Forventet'}</Txt>{sourceLabel && entry?.status === 'approved' && <Txt size={10} color={colors.muted}>{sourceLabel}</Txt>}</View>
    <Icon name="chevron-right" size={12} color={colors.muted} />
  </Pressable>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28 },
  period: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 }, periodButton: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', gap: 2 },
  summary: { padding: 16, paddingTop: 6 }, reset: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  calculation: { minHeight: 46, paddingHorizontal: 16, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  listTitle: { paddingHorizontal: 14, paddingVertical: 12, marginTop: 20, backgroundColor: cardColors.section, borderWidth: 1, borderColor: colors.line, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 80, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: colors.white, borderWidth: 1, borderTopWidth: 0, borderColor: colors.line },
  day: { width: 38, alignItems: 'center', gap: 1 }, more: { minHeight: 46, justifyContent: 'center', alignItems: 'center', backgroundColor: cardColors.section, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
});
