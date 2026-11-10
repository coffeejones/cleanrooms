import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ShiftTimeEntry } from '@/auth/mobile-auth-api';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-screens/experimental';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { FlowScreen } from '@/components/flow-screen';
import { HomeShiftDock } from '@/components/home-shift-dock';
import { useReduceMotionPreference } from '@/components/motion-preference';
import { PeriodArrows } from '@/components/period-arrows';
import { Row, Txt } from '@/components/ui';
import { ShiftRow } from '@/components/shift-row';
import { ScheduleFeedback } from '@/components/schedule-feedback';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { addDays, copenhagenDate, dateLabel, isoWeekNumber, mondayOfWeek, shiftInterval, upcoming, type AppState, type Site, type TimeEntry } from '@/domain/model';
import { useApp } from '@/state/app-store';
import { useMobileAuth } from '@/auth/mobile-auth';
import { usePublishedSchedule } from '@/state/published-schedule';
import { useEmployeeActiveTime } from '@/state/employee-data';

const { ink, accent, muted } = colors;

function entryView(shiftId: string, entry?: ShiftTimeEntry | null): TimeEntry | undefined {
  if (!entry?.clockIn) return undefined;
  return { shiftId, clockIn: entry.clockIn, ...(entry.clockOut ? { clockOut: entry.clockOut } : {}),
    pauses: [], comment: '', completedTaskIds: [], status: entry.status === 'rejected' ? 'submitted' : entry.status };
}

function shiftsForWeek(state: AppState, weekStart: string) {
  const weekEnd = addDays(weekStart, 6);
  const entriesByShift = new Map(state.entries.map(entry => [entry.shiftId, entry]));
  return upcoming(state, weekStart)
    .filter(shift => shift.date <= weekEnd)
    .map(shift => ({ shift, entry: entriesByShift.get(shift.id), site: undefined as Site | undefined, ...shiftInterval(shift) }));
}

export default function HomeScreen() {
  const { state, now } = useApp();
  const { state: auth } = useMobileAuth();
  const { fontScale } = useWindowDimensions();
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  // Content layout keeps the week heading clear without following the scroll offset.
  const [agendaTop, setAgendaTop] = useState<number | null>(null);
  const [agendaBodyTop, setAgendaBodyTop] = useState<number | null>(null);
  const live = auth.mode === 'signedIn';
  const today = live ? copenhagenDate(now) : state.today;
  const currentWeek = mondayOfWeek(today);
  const weekStart = selectedWeek ?? currentWeek;
  const showingCurrentWeek = weekStart === currentWeek;
  const weekEnd = addDays(weekStart, 6);
  const reduceMotion = useReduceMotionPreference();
  const previousWeek = useRef(weekStart);
  const weekSlide = useSharedValue(0);
  const weekMotion = useAnimatedStyle(() => {
    const offset = weekSlide.get();
    return { transform: [{ translateX: offset }], opacity: 1 - Math.abs(offset) * 0.025 };
  });

  useLayoutEffect(() => {
    const previous = previousWeek.current;
    previousWeek.current = weekStart;
    if (reduceMotion) {
      weekSlide.set(0);
    } else if (previous !== weekStart) {
      weekSlide.set(weekStart > previous ? 8 : -8);
      weekSlide.set(withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }));
    }
  }, [reduceMotion, weekSlide, weekStart]);

  const schedule = usePublishedSchedule(weekStart, weekEnd);
  const activeTime = useEmployeeActiveTime();
  const activeLiveRecord = activeTime.data ?? null;
  const currentWeekShifts = useMemo(() => shiftsForWeek(state, currentWeek), [state, currentWeek]);
  const weekShifts = useMemo(() => {
    if (live) return (schedule.data ?? []).map(({ shift, site, entry }) => ({ shift, site, entry: entryView(shift.id, entry), ...shiftInterval(shift) }))
      .sort((a, b) => a.start - b.start);
    return showingCurrentWeek ? currentWeekShifts : shiftsForWeek(state, weekStart);
  }, [currentWeekShifts, live, schedule.data, showingCurrentWeek, state, weekStart]);
  const activeEntry = live ? (activeLiveRecord ? entryView(activeLiveRecord.shift.id, activeLiveRecord.entry) : undefined) : state.entries.find(entry => entry.status === 'running' || entry.status === 'paused');
  const activeShift = live ? activeLiveRecord?.shift : activeEntry && state.shifts.find(shift => shift.id === activeEntry.shiftId && shift.personId === state.selfId);
  const upcomingShift = (live ? (showingCurrentWeek ? weekShifts : []) : currentWeekShifts)
    .find(record => record.end > now && !record.entry);
  const next = activeShift ?? upcomingShift?.shift;
  const nextStart = activeShift ? shiftInterval(activeShift).start : upcomingShift?.start;
  const site = live ? activeLiveRecord?.site ?? upcomingShift?.site : state.sites.find(place => place.id === next?.siteId);
  const agenda = weekShifts.filter(record => record.shift.id !== next?.id);
  const weekShiftCount = live && !schedule.data ? null : weekShifts.length;

  function moveWeek(direction: -1 | 1) {
    setSelectedWeek(previous => {
      const target = addDays(previous ?? currentWeek, direction * 7);
      return target === currentWeek ? null : target;
    });
  }

  const date = dateLabel(today, { weekday: 'long', month: 'long' });
  const todayLabel = date.charAt(0).toLocaleUpperCase('da-DK') + date.slice(1);
  const dateInHeader = fontScale <= 1.12;
  const headerOptions = useMemo(() => ({
    headerStyle: { backgroundColor: cardColors.canvas },
    headerTitle: () => (
      <Row gap={9} style={{ minWidth: 0 }}>
        <Image source={require('../../assets/images/app-icon.png')} style={styles.brandMark} accessibilityElementsHidden />
        <View style={styles.brandText}>
          <Txt size={18} weight="700" color={ink} accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.6} style={styles.brandName}>
            CleanRooms
          </Txt>
          {dateInHeader && <Txt size={12} color={muted} numberOfLines={1}>{todayLabel}</Txt>}
        </View>
      </Row>
    ),
  }), [dateInHeader, todayLabel]);

  const content = <>
    <Stack.Screen options={headerOptions} />
    <FlowScreen backgroundTop={agendaTop !== null && agendaBodyTop !== null ? agendaTop + agendaBodyTop : null}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={live ? <RefreshControl refreshing={schedule.refreshing || activeTime.refreshing} onRefresh={() => { schedule.refresh(); activeTime.refresh(); }} /> : undefined}
      >
        {!dateInHeader && <Txt size={15} weight="600" color={muted}>{todayLabel}</Txt>}
        {live && activeTime.error && <ScheduleFeedback error={activeTime.error} onRetry={activeTime.refresh} />}
        <View style={styles.agenda} onLayout={event => setAgendaTop(event.nativeEvent.layout.y)}>
          <Row gap={12} style={styles.sectionHead}>
            <View style={styles.sectionIntro}>
              <Row gap={8} style={styles.weekHeading}>
                <Txt size={22} weight="600" color={ink} accessibilityRole="header" style={styles.sectionTitle}>Uge {isoWeekNumber(weekStart)}</Txt>
                {weekShiftCount !== null && (
                  <Txt size={12} color={muted}>{weekShiftCount} {weekShiftCount === 1 ? 'vagt' : 'vagter'}</Txt>
                )}
              </Row>
              <Txt size={12} color={muted} style={styles.weekDates}>{dateLabel(weekStart)} – {dateLabel(weekEnd, { year: 'numeric' })}</Txt>
            </View>
            <Row gap={6}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Gå til denne uge"
                accessibilityState={{ disabled: showingCurrentWeek }}
                disabled={showingCurrentWeek}
                onPress={() => setSelectedWeek(null)}
                style={({ pressed }) => [styles.todayButton, pressed && styles.softPressed]}
              >
                <Txt size={13} weight="500" color={showingCurrentWeek ? muted : accent} selectable={false}>I dag</Txt>
              </Pressable>
              <PeriodArrows
                previousLabel="Forrige uge"
                nextLabel="Næste uge"
                onPrevious={() => moveWeek(-1)}
                onNext={() => moveWeek(1)}
              />
            </Row>
          </Row>
          <View style={styles.agendaBody} onLayout={event => setAgendaBodyTop(event.nativeEvent.layout.y)}>
            <Animated.View style={[cardStyles.listSurface, styles.agendaList, weekMotion]}>
              <ScheduleFeedback loading={schedule.loading && !schedule.data} error={schedule.error} onRetry={schedule.refresh} />
              {agenda.map(({ shift, site: publishedSite, entry, end }, index) => (
                <View key={shift.id}>
                  {index > 0 && <View style={[cardStyles.divider, styles.agendaDivider]} />}
                  <ShiftRow shift={shift} publishedSite={publishedSite} publishedToday={live ? today : undefined}
                    publishedEntry={live ? schedule.data?.find(item => item.shift.id === shift.id)?.entry : undefined}
                    dateTile endedWithoutEntry={!live && !entry && end <= now} />
                </View>
              ))}
              {!agenda.length && (!live || (schedule.data && !schedule.error)) && (
                <Txt size={13} color={muted} style={styles.emptyAgenda}>
                  {weekShifts.length ? 'Ingen andre vagter i denne uge.' : 'Ingen vagter i denne uge.'}
                </Txt>
              )}
            </Animated.View>
          </View>
        </View>
      </ScrollView>
    </FlowScreen>
    {next && nextStart !== undefined && (
      <View style={styles.dock}>
        <HomeShiftDock
          shift={next}
          today={today}
          siteName={site?.name ?? 'Arbejdssted'}
          start={nextStart}
          entry={activeShift ? activeEntry : undefined}
          live={live}
          serverClock={live ? activeLiveRecord?.entry ?? undefined : undefined}
        />
      </View>
    )}
  </>;

  return process.env.EXPO_OS === 'ios' ? (
    <SafeAreaView edges={{ bottom: true }} style={styles.canvas}>{content}</SafeAreaView>
  ) : (
    <View style={styles.canvas}>{content}</View>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: cardColors.canvas },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, gap: 16 },
  dock: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8 },
  brandMark: { width: 32, height: 32, borderRadius: 8, borderCurve: 'continuous' },
  brandName: { letterSpacing: -.4, lineHeight: 22 },
  brandText: { flexShrink: 1 },
  agenda: { flexGrow: 1, gap: 16 },
  agendaBody: { flexGrow: 1 },
  agendaList: { overflow: 'hidden' },
  agendaDivider: { marginHorizontal: 16 },
  sectionHead: { justifyContent: 'space-between', paddingTop: 4 },
  sectionIntro: { flex: 1, minWidth: 0, gap: 3 },
  weekHeading: { alignItems: 'baseline', flexWrap: 'wrap', rowGap: 0 },
  sectionTitle: { letterSpacing: -.55, lineHeight: 28 },
  weekDates: { lineHeight: 17 },
  todayButton: { minHeight: 44, justifyContent: 'center', borderRadius: 8, paddingHorizontal: 8 },
  emptyAgenda: { paddingVertical: 24, paddingHorizontal: 16 },
  softPressed: { backgroundColor: colors.paper },
});
