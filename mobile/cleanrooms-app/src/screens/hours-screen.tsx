import { useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import type { NavigationProp } from 'expo-router/react-navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import { useMobileAuth } from '@/auth/mobile-auth';
import LiveHoursScreen from '@/screens/live-hours-screen';

import { FlowScreen } from '@/components/flow-screen';
import { PressFeedback } from '@/components/press-feedback';
import { PeriodArrows } from '@/components/period-arrows';
import { PeriodPicker } from '@/components/period-picker';
import { PeriodProgress } from '@/components/period-progress';
import { ShiftDetailsButton } from '@/components/shift-details-button';
import { EmptyState, Icon, LiveClock, Row, Txt } from '@/components/ui';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import {
  addDays, currency, dateLabel, instantForLocal, minutesLabel, payPeriod,
  shiftInterval, shiftPay, summarizePeriod,
  type AppState, type Shift,
} from '@/domain/model';
import { useAppData, useNow } from '@/state/app-store';

type HoursParams = { period?: string };
const previewLimit = 4;
const calculationEnter = FadeIn.duration(180).reduceMotion(ReduceMotion.System);

export default function HoursScreen() {
  const { state } = useMobileAuth();
  return state.mode === 'signedIn' ? <LiveHoursScreen /> : <DemoHoursScreen />;
}

function DemoHoursScreen() {
  const { period: periodIntent } = useLocalSearchParams<HoursParams>();
  const navigation = useNavigation<NavigationProp<{ hours: HoursParams }>>();
  const listRef = useRef<FlatList<Shift>>(null);
  const { state } = useAppData();
  const [offset, setOffset] = useState(0);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [calculationOpen, setCalculationOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const showCurrentPeriod = periodIntent === 'current';
  const period = showCurrentPeriod ? payPeriod(state.today) : custom ?? payPeriod(state.today, offset);

  useFocusEffect(useCallback(() => {
    if (!showCurrentPeriod) return;
    setCustom(null);
    setOffset(0);
    setShowAll(false);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    navigation.setParams({ period: undefined });
  }, [navigation, showCurrentPeriod]));

  const summary = useMemo(
    // Closed records have their own end timestamp; period totals do not follow the live clock.
    () => summarizePeriod(state, period.from, period.to, instantForLocal(addDays(period.to, 1), '00:00')),
    [state, period.from, period.to],
  );
  const shifts = useMemo(() => {
    const entries = new Map(state.entries.map(entry => [entry.shiftId, entry]));
    const rank = (shift: Shift) => {
      const entry = entries.get(shift.id);
      if (entry?.status === 'running' || entry?.status === 'paused') return 0;
      return entry?.clockOut ? 1 : 2;
    };
    return state.shifts
      .filter(shift => shift.personId === state.selfId && shift.date >= period.from && shift.date <= period.to)
      .sort((a, b) => {
        const rankA = rank(a), rankB = rank(b);
        if (rankA !== rankB) return rankA - rankB;
        const byStart = a.date.localeCompare(b.date) || a.start.localeCompare(b.start);
        return rankA === 1 ? -byStart : byStart;
      });
  }, [state.shifts, state.selfId, state.entries, period.from, period.to]);
  const hasMore = shifts.length > previewLimit;
  const visibleShifts = showAll ? shifts : shifts.slice(0, previewLimit);
  const future = period.from > state.today;
  const approvedLabel = summary.approvedMinutes > 0 ? `${minutesLabel(summary.approvedMinutes)} godkendt` : null;
  const basePay = future ? summary.baseEstimatedCents : summary.baseEarnedCents;
  const allowances = future ? summary.allowanceEstimatedCents : summary.allowanceEarnedCents;
  const totalPay = future ? summary.estimatedCents : summary.earnedCents;
  const sameYear = period.from.slice(0, 4) === period.to.slice(0, 4);
  const periodLabel = `${dateLabel(period.from, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })} – ${dateLabel(period.to, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const navigate = (direction: number) => {
    setCustom(null);
    setOffset((value) => custom ? direction : value + direction);
    setShowAll(false);
  };

  return (
    <>
      <FlowScreen>
        <FlatList
          ref={listRef}
          data={visibleShifts}
          keyExtractor={(shift) => shift.id}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          windowSize={5}
          style={styles.canvas}
          contentContainerStyle={styles.content}
          ListHeaderComponent={
            <>
              <View style={cardStyles.listSurface}>
                <View>
                  <Row gap={8} style={styles.periodHeader}>
                    <PressFeedback haptic="selection"
                      accessibilityRole="button"
                      accessibilityLabel={`Vælg periode, ${periodLabel}`}
                      onPress={() => setPickerVisible(true)}
                      style={({ pressed }) => [styles.periodButton, pressed && styles.pressed]}>
                      <Txt size={12} weight="600" color={colors.muted}>{custom && !showCurrentPeriod ? 'Valgt periode' : 'Lønperiode'}</Txt>
                      <Row gap={6}>
                        <Txt size={15} weight="600" style={styles.periodTitle}>{periodLabel}</Txt>
                        <Icon name="chevron-down" size={11} color={colors.muted} />
                      </Row>
                    </PressFeedback>
                    <PeriodArrows
                      previousLabel="Forrige lønperiode"
                      nextLabel="Næste lønperiode"
                      onPrevious={() => navigate(-1)}
                      onNext={() => navigate(1)}
                    />
                  </Row>
                  {!showCurrentPeriod && (custom || offset !== 0) && (
                    <PressFeedback haptic="selection"
                      accessibilityRole="button"
                      onPress={() => {
                        setCustom(null);
                        setOffset(0);
                        setShowAll(false);
                      }}
                      style={({ pressed }) => [styles.resetPeriod, pressed && styles.pressed]}>
                      <Txt size={13} color={colors.accent} weight="600">Denne lønperiode</Txt>
                    </PressFeedback>
                  )}
                  <View style={styles.summary}>
                    <PeriodProgress summary={summary} future={future} />
                  </View>
                  <PressFeedback haptic="selection"
                    accessibilityRole="button"
                    accessibilityLabel={approvedLabel ? `Lønberegning, ${approvedLabel}` : 'Lønberegning'}
                    accessibilityState={{ expanded: calculationOpen }}
                    onPress={() => setCalculationOpen(value => !value)}
                    style={({ pressed }) => [styles.calculationButton, !calculationOpen && styles.calculationEnd, pressed && styles.pressed]}>
                    <Row gap={10} style={styles.calculationLabel}>
                      <Txt size={13} weight="600" style={{ flex: 1 }}>Lønberegning</Txt>
                      {approvedLabel && (
                        <Txt size={12} color={colors.muted} style={{ textAlign: 'right', flexShrink: 1 }}>{approvedLabel}</Txt>
                      )}
                      <View style={{ transform: [{ rotate: calculationOpen ? '180deg' : '0deg' }] }}>
                        <Icon name="chevron-down" size={12} color={colors.muted} />
                      </View>
                    </Row>
                  </PressFeedback>
                  {calculationOpen && (
                    <Animated.View entering={calculationEnter} style={styles.calculation}>
                      <AmountRow label="Grundløn" amount={basePay} />
                      <AmountRow label="Aften- og weekendtillæg" amount={allowances} />
                      <Row gap={12} style={styles.total}>
                        <Txt size={13} weight="600" style={{ flex: 1 }}>{future ? 'Forventet i alt før skat' : 'I alt før skat'}</Txt>
                        <Txt size={14} weight="600" style={styles.amount}>{currency(totalPay)}</Txt>
                      </Row>
                    </Animated.View>
                  )}
                </View>
              </View>
              {shifts.length > 0 && (
                <Row gap={10} style={styles.listHeader}>
                  <Row gap={7} style={styles.listTitle}>
                    <Txt size={15} weight="600" accessibilityRole="header">Vagter i perioden</Txt>
                    <Txt size={12} color={colors.muted}>{shifts.length}</Txt>
                  </Row>
                  <Txt size={12} weight="500" color={colors.muted}>Før skat</Txt>
                </Row>
              )}
            </>
          }
          ListEmptyComponent={
            <View style={[cardStyles.listSurface, styles.empty]}>
              <EmptyState title="Ingen vagter i perioden" body="Dine vagter og registrerede timer samles her." icon="calendar" />
            </View>
          }
          ListFooterComponent={hasMore ? (
            <PressFeedback haptic="selection"
              accessibilityRole="button"
              accessibilityState={{ expanded: showAll }}
              onPress={() => {
                if (showAll) listRef.current?.scrollToOffset({ offset: 0, animated: false });
                setShowAll(!showAll);
              }}
              style={({ pressed }) => [styles.more, pressed && styles.pressed]}
            >
              <Txt size={13} weight="600" color={colors.accent}>{showAll ? 'Vis færre vagter' : `Vis alle ${shifts.length} vagter`}</Txt>
              <View style={showAll && styles.chevronUp}>
                <Icon name="chevron-down" size={12} color={colors.accent} />
              </View>
            </PressFeedback>
          ) : null}
          renderItem={({ item, index }) => (
            <HoursRecord
              shift={item} state={state} from={period.from} to={period.to}
              last={!hasMore && index === visibleShifts.length - 1}
            />
          )}
        />
      </FlowScreen>
      <PeriodPicker
        visible={pickerVisible}
        from={period.from}
        to={period.to}
        onApply={(from, to) => {
          setCustom({ from, to });
          setShowAll(false);
        }}
        onDismiss={() => setPickerVisible(false)}
      />
    </>
  );
}

function AmountRow({ label, amount }: { label: string; amount: number }) {
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={14}>
      <Txt size={13} color={colors.muted} style={{ flex: 1 }}>{label}</Txt>
      <Txt size={14} weight="500" style={styles.amount}>{currency(amount)}</Txt>
    </Row>
  );
}

function HoursRecord({ shift, state, from, to, last }: {
  shift: Shift; state: AppState; from: string; to: string; last: boolean;
}) {
  const now = useNow();
  const entry = state.entries.find((item) => item.shiftId === shift.id);
  const site = state.sites.find((item) => item.id === shift.siteId);
  const pay = useMemo(() => shiftPay(shift, entry, { from, to }), [shift, entry, from, to]);
  const active = entry && (entry.status === 'running' || entry.status === 'paused');
  const registered = pay.kind === 'registered';
  const scheduledEnd = useMemo(() => shiftInterval(shift).end, [shift]);
  const missing = !entry && now >= scheduledEnd;
  const status = active ? (entry.status === 'paused' ? 'På pause' : 'I gang')
    : registered ? (entry?.status === 'approved' ? 'Godkendt' : 'Til godkendelse')
    : missing ? 'Ikke registreret' : 'Planlagt';
  const worksite = site?.name ?? 'Arbejdssted';
  const date = dateLabel(shift.date);
  const [day, month] = date.split(/\s+/, 2);
  const isToday = shift.date === state.today;
  const plannedTime = `${shift.start}–${shift.end}`;
  const amount = currency(pay.totalCents);
  const payCaption = registered ? `${minutesLabel(pay.minutes)} registreret`
    : active || missing ? 'Forventet' : `Forventet · ${minutesLabel(pay.minutes)}`;
  return (
    <ShiftDetailsButton shiftId={shift.id} haptic="light"
      accessibilityRole="button"
      accessibilityLabel={`${date}, ${worksite}, planlagt ${plannedTime}, ${status}, ${amount} før skat, ${payCaption}`}
      style={({ pressed }) => [
        styles.record, last && styles.lastRecord, pressed && styles.pressed,
      ]}>
      <View style={styles.recordDate} aria-hidden>
        <Txt size={18} weight="700" color={isToday ? colors.accent : colors.ink} maxFontSizeMultiplier={1.5} style={styles.dateDay}>
          {day}
        </Txt>
        <Txt size={11} weight="500" color={colors.muted} maxFontSizeMultiplier={1.5}>{month}</Txt>
      </View>
      <View style={styles.recordDetails}>
        <Txt size={15} weight="600">{plannedTime}</Txt>
        <Txt size={13} color={colors.muted} numberOfLines={2}>{worksite}</Txt>
        <Row gap={4}>
          {entry?.status === 'approved' && <Icon name="check" size={11} color={colors.success} />}
          {entry?.status === 'paused' && <Icon name="pause" size={12} color={colors.warning} />}
          {entry?.status === 'running' && <LiveClock size={12} color={colors.success} />}
          <Txt size={11} weight="500" color={colors.muted} style={{ flexShrink: 1 }}>{status}</Txt>
        </Row>
      </View>
      <View style={styles.recordPay}>
        <Txt size={15} weight="600" style={styles.amount}>{amount}</Txt>
        <Txt size={12} color={colors.muted} style={styles.amount}>
          {active || missing ? 'Forventet' : minutesLabel(pay.minutes)}
        </Txt>
      </View>
      <Icon name="chevron-right" size={12} color={colors.muted} />
    </ShiftDetailsButton>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28 },
  periodHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 },
  periodButton: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', gap: 2, borderRadius: 7 },
  periodTitle: { flexShrink: 1, letterSpacing: -.15 },
  resetPeriod: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginHorizontal: 14, paddingHorizontal: 4, borderRadius: 7 },
  pressed: { backgroundColor: colors.paper },
  summary: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 16 },
  calculationButton: { minHeight: 46, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  calculationEnd: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12, borderCurve: 'continuous' },
  calculationLabel: { justifyContent: 'space-between' },
  calculation: { gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  total: { justifyContent: 'space-between', paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  listHeader: {
    justifyContent: 'space-between', flexWrap: 'wrap', minHeight: 46,
    paddingVertical: 12, paddingLeft: 14, paddingRight: 34, marginTop: 20,
    backgroundColor: cardColors.section, borderWidth: 1, borderBottomWidth: 0, borderColor: cardColors.border,
    borderTopLeftRadius: 12, borderTopRightRadius: 12, borderCurve: 'continuous',
  },
  listTitle: { flexShrink: 1, letterSpacing: -.3 },
  empty: { marginTop: 17 },
  record: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 80, paddingVertical: 12, paddingHorizontal: 14,
    borderColor: cardColors.border, borderWidth: 1, borderBottomWidth: 0, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line, borderCurve: 'continuous', backgroundColor: colors.white,
  },
  lastRecord: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12, borderBottomWidth: 1 },
  more: {
    minHeight: 46, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: cardColors.section, borderWidth: 1, borderColor: cardColors.border, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, borderCurve: 'continuous',
  },
  chevronUp: { transform: [{ rotate: '180deg' }] },
  recordDate: { width: 38, flexShrink: 0, gap: 1, alignItems: 'center' },
  dateDay: { lineHeight: 22, letterSpacing: -.3 },
  recordDetails: { flex: 1, minWidth: 0, gap: 2 },
  recordPay: { maxWidth: '46%', alignItems: 'flex-end', gap: 2 },
  amount: { flexShrink: 1, textAlign: 'right' },
});
