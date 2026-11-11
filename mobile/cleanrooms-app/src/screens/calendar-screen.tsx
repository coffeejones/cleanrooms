import { router, useLocalSearchParams } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { I18nManager, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { CalendarMonthPicker } from '@/components/calendar-month-picker';
import { CalendarOpenShifts } from '@/components/calendar-open-shifts';
import { FlowScreen } from '@/components/flow-screen';
import { LiveOpenShifts } from '@/components/live-open-shifts';
import { useReduceMotionPreference } from '@/components/motion-preference';
import { PeriodArrows } from '@/components/period-arrows';
import { PressFeedback } from '@/components/press-feedback';
import { ShiftRow } from '@/components/shift-row';
import { ScheduleFeedback } from '@/components/schedule-feedback';
import { EmptyState, Icon, Row, Txt } from '@/components/ui';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { addDays, copenhagenDate, dateLabel, mondayOfWeek, type Shift } from '@/domain/model';
import { useAppData, useNow } from '@/state/app-store';
import { useMobileAuth } from '@/auth/mobile-auth';
import { usePublishedSchedule } from '@/state/published-schedule';
import { useEmployeePreferences, type EmployeePreferences } from '@/state/employee-data';

const weekdays = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];
const scopes = [{ label: 'Mine vagter', view: 'mine' }, { label: 'Ledige vagter', view: 'open' }] as const;
const scopeSlideDirection = I18nManager.isRTL ? -1 : 1;
const daysPerWeek = 7;
const millisecondsPerDay = 86_400_000;
const monthSlideDistance = 32;
const monthSlideTiming = { duration: 220, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.Never };

function moveMonth(month: string, offset: number) {
  const date = new Date(month + 'T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 10);
}

function dateNumber(date: string) {
  return Number(date.slice(-2));
}

function selectDayInMonth(previous: string, targetMonth: string) {
  const daysInMonth = dateNumber(addDays(moveMonth(targetMonth, 1), -1));
  return addDays(targetMonth, Math.min(dateNumber(previous), daysInMonth) - 1);
}

function capitalize(text: string) {
  return text.charAt(0).toLocaleUpperCase('da-DK') + text.slice(1);
}

function DaySelectionIndicator({ selected, focused, reduceMotion }: {
  selected: boolean;
  focused: boolean;
  reduceMotion: boolean;
}) {
  const previousSelected = useRef(selected);
  const settle = useSharedValue(1);
  const motion = useAnimatedStyle(() => ({
    opacity: .9 + .1 * settle.get(),
    transform: [{ scale: .96 + .04 * settle.get() }],
  }));

  useLayoutEffect(() => {
    const becameSelected = selected && !previousSelected.current;
    previousSelected.current = selected;
    cancelAnimation(settle);
    if (becameSelected && focused && !reduceMotion) {
      settle.set(0);
      settle.set(withTiming(1, { duration: 170, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.Never }));
    } else {
      settle.set(1);
    }
    return () => cancelAnimation(settle);
  }, [focused, reduceMotion, selected, settle]);

  return selected ? (
    <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.daySelection, motion]} />
  ) : null;
}

export default function CalendarScreen() {
  const { state, actions } = useAppData();
  const { state: auth, employeeRequest } = useMobileAuth();
  const live = auth.mode === 'signedIn';
  const now = useNow();
  const today = live ? copenhagenDate(now) : state.today;
  const { view } = useLocalSearchParams<{ view?: string }>();
  const [{ date: selection, swipeDirection }, setSelection] = useState({ date: today, swipeDirection: 0 });
  const [picker, setPicker] = useState({ visible: false, year: Number(today.slice(0, 4)) });
  const [availabilityError, setAvailabilityError] = useState<{ date: string; message: string } | null>(null);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [backgroundTop, setBackgroundTop] = useState<number | null>(null);
  const availabilityPending = useRef(false);
  const preferences = useEmployeePreferences();
  const employee = auth.mode === 'signedIn' ? auth.session.employee : null;
  const preferenceKey = employee ? JSON.stringify([employee.workspaceId, employee.personId]) : '';
  const [savedAvailability, setSavedAvailability] = useState<{ key: string; preferences: EmployeePreferences }>();
  const ownPreferences = savedAvailability?.key === preferenceKey && savedAvailability.preferences.version >= (preferences.data?.version ?? 0)
    ? savedAvailability.preferences : preferences.data;
  const reduceMotion = useReduceMotionPreference();
  const focused = useIsFocused();
  const previousSelection = useRef(selection);
  const slideX = useSharedValue(0);
  const slideStyle = useAnimatedStyle(() => {
    const x = slideX.get();
    return { transform: [{ translateX: x }], opacity: 1 - 0.45 * Math.abs(x) / monthSlideDistance };
  });

  useLayoutEffect(() => {
    const dateChanged = previousSelection.current !== selection;
    previousSelection.current = selection;
    cancelAnimation(slideX);
    if (reduceMotion || !focused || !swipeDirection) {
      slideX.set(0);
    } else if (dateChanged) {
      slideX.set(swipeDirection * monthSlideDistance);
      slideX.set(withTiming(0, monthSlideTiming));
    }
    return () => cancelAnimation(slideX);
  }, [focused, reduceMotion, selection, slideX, swipeDirection]);

  const open = view === 'open';
  const previousScope = useRef(open);
  const scopePosition = useSharedValue(open ? 100 : 0);
  const scopeIndicatorMotion = useAnimatedStyle(() => ({
    transform: [{ translateX: `${scopeSlideDirection * scopePosition.get()}%` as const }],
  }));

  useLayoutEffect(() => {
    const changed = previousScope.current !== open;
    previousScope.current = open;
    const position = open ? 100 : 0;
    scopePosition.set(changed && focused && !reduceMotion
      ? withTiming(position, { duration: 110, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.Never })
      : position);
    return () => cancelAnimation(scopePosition);
  }, [focused, open, reduceMotion, scopePosition]);

  const previousAgenda = useRef({ selection, focused, open });
  const agendaSettle = useSharedValue(1);
  const agendaMotion = useAnimatedStyle(() => ({
    opacity: .88 + .12 * agendaSettle.get(),
    transform: [{ translateY: 3 * (1 - agendaSettle.get()) }],
  }));

  useLayoutEffect(() => {
    const previous = previousAgenda.current;
    previousAgenda.current = { selection, focused, open };
    cancelAnimation(agendaSettle);
    if (!reduceMotion && focused && previous.focused && !open && !previous.open && previous.selection !== selection) {
      agendaSettle.set(0);
      agendaSettle.set(withTiming(1, { duration: 170, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.Never }));
    } else {
      agendaSettle.set(1);
    }
    return () => cancelAnimation(agendaSettle);
  }, [agendaSettle, focused, open, reduceMotion, selection]);

  const isTodaySelected = selection === today;
  const monthKey = selection.slice(0, 7);
  const year = Number(monthKey.slice(0, 4));
  const month = monthKey + '-01';
  const firstDay = mondayOfWeek(month);
  const followingMonth = moveMonth(month, 1);
  const weekCount = Math.ceil(
    (Date.parse(followingMonth) - Date.parse(firstDay)) / (daysPerWeek * millisecondsPerDay),
  );
  const schedule = usePublishedSchedule(firstDay, addDays(firstDay, weekCount * daysPerWeek - 1));
  const weeks = Array.from({ length: weekCount }, (_, weekIndex) =>
    Array.from({ length: daysPerWeek }, (_, dayIndex) => addDays(firstDay, weekIndex * daysPerWeek + dayIndex)),
  );
  const periodTitle = capitalize(dateLabel(month, { month: 'long', day: undefined }));

  const ownShiftsByDate = useMemo(() => {
    const groups = new Map<string, Shift[]>();
    const shifts = live ? (schedule.data ?? []).map(item => item.shift) : state.shifts.filter(shift => shift.personId === state.selfId);
    for (const shift of shifts) {
      const group = groups.get(shift.date);
      if (group) group.push(shift);
      else groups.set(shift.date, [shift]);
    }
    for (const group of groups.values()) group.sort((a, b) => a.start.localeCompare(b.start));
    return groups;
  }, [live, schedule.data, state.shifts, state.selfId]);
  const publishedSites = useMemo(() => new Map(schedule.data?.map(item => [item.shift.id, item.site])), [schedule.data]);
  const publishedEntries = useMemo(() => new Map(schedule.data?.map(item => [item.shift.id, item.entry])), [schedule.data]);
  const selectedShifts = ownShiftsByDate.get(selection) ?? [];
  const unavailableDates = useMemo(() => new Set(live ? ownPreferences?.unavailableDates ?? [] : state.unavailableDates), [live, ownPreferences?.unavailableDates, state.unavailableDates]);
  const selectedUnavailable = unavailableDates.has(selection);
  const canEditAvailability = selection >= today || selectedUnavailable;

  async function changeAvailability() {
    if (live) {
      if (!ownPreferences || availabilityPending.current) return;
      availabilityPending.current = true;
      setAvailabilityBusy(true); setAvailabilityError(null);
      const date = selection;
      try {
        const result = await employeeRequest<EmployeePreferences>({ action: 'employeeAvailability', version: ownPreferences.version, date, unavailable: !selectedUnavailable });
        if (!result || !Number.isSafeInteger(result.version) || !Array.isArray(result.unavailableDates)) throw new Error('Markeringen kunne ikke bekræftes. Prøv igen.');
        setSavedAvailability({ key: preferenceKey, preferences: result });
        preferences.refresh();
      } catch (failure) {
        setAvailabilityError({ date, message: failure instanceof Error ? failure.message : 'Markeringen kunne ikke gemmes. Prøv igen.' });
        preferences.refresh();
      } finally { availabilityPending.current = false; setAvailabilityBusy(false); }
      return;
    }
    const result = actions.setUnavailableDate(selection, !selectedUnavailable);
    setAvailabilityError(result.ok ? null : {
      date: selection,
      message: result.error ?? 'Markeringen kunne ikke gemmes. Prøv igen.',
    });
  }

  const changeMonth = useCallback((offset: -1 | 1, swiped = false) => {
    setSelection(({ date: previous }) => {
      const targetMonth = moveMonth(previous.slice(0, 7) + '-01', offset);
      return {
        date: selectDayInMonth(previous, targetMonth),
        swipeDirection: swiped ? offset : 0,
      };
    });
  }, []);

  const monthSwipe = useMemo(() => Gesture.Pan()
    .maxPointers(1)
    .activeOffsetX([-18, 18])
    .failOffsetY([-14, 14])
    .runOnJS(true)
    .onEnd(({ translationX, translationY }, completed) => {
      if (!completed || Math.abs(translationX) < 48 || Math.abs(translationX) <= Math.abs(translationY)) return;
      changeMonth(translationX < 0 ? 1 : -1, true);
    }), [changeMonth]);

  function closePicker() {
    setPicker(previous => ({ ...previous, visible: false }));
  }

  const calendar = (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={live ? <RefreshControl refreshing={schedule.refreshing || preferences.refreshing} onRefresh={() => { schedule.refresh(); preferences.refresh(); }} /> : undefined}
    >
      <Row gap={0} style={styles.scopeBar} onLayout={event => setBackgroundTop(event.nativeEvent.layout.y + event.nativeEvent.layout.height + 16)}>
        {scopes.map((scope) => {
          const selected = scope.view === (open ? 'open' : 'mine');
          return (
            <PressFeedback
              key={scope.view}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              haptic={selected ? false : 'selection'}
              onPress={() => router.setParams({ view: scope.view })}
              style={({ pressed }) => [styles.scopeTab, pressed && styles.pressed]}
            >
              <Txt size={14} weight={selected ? '700' : '500'} color={selected ? colors.ink : colors.muted} style={styles.centered}>
                {scope.label}
              </Txt>
            </PressFeedback>
          );
        })}
        <Animated.View pointerEvents="none" aria-hidden style={[styles.scopeIndicator, scopeIndicatorMotion]} />
      </Row>

      {open ? live ? <LiveOpenShifts from={today} to={addDays(today, 55)} unavailableDates={unavailableDates} /> : <CalendarOpenShifts shifts={state.shifts} /> : (
        <>
          <GestureHandlerRootView style={cardStyles.raisedFrame}>
            <View style={[cardStyles.raisedSurface, styles.calendarPanel]}>
              <Row gap={8} style={styles.periodHeader}>
                <PressFeedback
                  accessibilityRole="button"
                  accessibilityLabel={`Vælg måned, ${periodTitle} ${year}`}
                  accessibilityState={{ expanded: picker.visible }}
                  onPress={() => setPicker({ visible: true, year })}
                  style={({ pressed }) => [styles.periodText, pressed && styles.pressed]}
                >
                  <Row gap={6}>
                    <Txt size={22} weight="700" selectable={false} style={styles.periodTitle}>{periodTitle}</Txt>
                    <Icon name="chevron-down" size={13} color={colors.accent} />
                  </Row>
                  <Txt size={12} color={colors.muted} selectable={false}>{year}</Txt>
                </PressFeedback>
                <Row gap={6}>
                  <PressFeedback
                    accessibilityRole="button"
                    accessibilityLabel="Gå til i dag"
                    accessibilityState={{ disabled: isTodaySelected }}
                    disabled={isTodaySelected}
                    haptic="selection"
                    onPress={() => setSelection({ date: today, swipeDirection: 0 })}
                    style={({ pressed }) => [styles.todayButton, pressed && styles.pressed]}
                  >
                    <Txt size={13} weight="600" color={isTodaySelected ? colors.muted : colors.accent} selectable={false}>I dag</Txt>
                  </PressFeedback>
                  <PeriodArrows
                    previousLabel="Forrige måned"
                    nextLabel="Næste måned"
                    onPrevious={() => changeMonth(-1)}
                    onNext={() => changeMonth(1)}
                  />
                </Row>
              </Row>

              <GestureDetector gesture={monthSwipe} touchAction="pan-y">
                <View style={styles.grid}>
                  <Row gap={3} style={styles.weekdays} aria-hidden>
                    {weekdays.map((day) => (
                      <Txt key={day} size={11} weight="600" color={colors.muted} style={styles.weekday} maxFontSizeMultiplier={1.5}>
                        {day}
                      </Txt>
                    ))}
                  </Row>
                  <Animated.View style={[styles.weeks, slideStyle]}>
                    {weeks.map((week) => (
                      <Row key={week[0]} gap={3} style={styles.week}>
                        {week.map((date) => {
                          const count = ownShiftsByDate.get(date)?.length ?? 0;
                          const selected = date === selection;
                          const isToday = date === today;
                          const outsideMonth = date.slice(0, 7) !== monthKey;
                          const unavailable = unavailableDates.has(date);
                          const shiftCount = `${count} ${count === 1 ? 'vagt' : 'vagter'}`;
                          const label = `${dateLabel(date, { weekday: 'long' })}, ${shiftCount}${unavailable ? ', utilgængelig hele dagen' : ''}`;
                          const dateColor = selected ? colors.white : isToday ? colors.accent : outsideMonth ? colors.muted : colors.ink;
                          return (
                            <PressFeedback
                              key={date}
                              accessibilityRole="button"
                              accessibilityLabel={isToday ? 'I dag, ' + label : label}
                              accessibilityState={{ selected }}
                              haptic={selected ? false : 'selection'}
                              onPress={() => setSelection({ date, swipeDirection: 0 })}
                              style={({ pressed }) => [
                                styles.day, unavailable && styles.unavailableDay, isToday && styles.todayCell,
                                selected && styles.selectedDay, pressed && !selected && styles.pressed,
                              ]}
                            >
                              <DaySelectionIndicator selected={selected} focused={focused} reduceMotion={reduceMotion} />
                              <Txt size={16} weight={selected || isToday ? '700' : '500'} color={dateColor} maxFontSizeMultiplier={1.6}>
                                {dateNumber(date)}
                              </Txt>
                              <Row gap={3} style={styles.markers} aria-hidden>
                                {Array.from({ length: Math.min(count, 3) }, (_, index) => (
                                  <View key={index} style={[styles.marker, selected && styles.selectedMarker]} />
                                ))}
                                {unavailable && <View style={[styles.unavailableMarker, selected && styles.selectedUnavailableMarker]} />}
                              </Row>
                            </PressFeedback>
                          );
                        })}
                      </Row>
                    ))}
                  </Animated.View>
                </View>
              </GestureDetector>
            </View>
          </GestureHandlerRootView>

          <Animated.View style={[cardStyles.listSurface, agendaMotion]}>
            <Row gap={12} style={styles.agendaHeading}>
              <Txt size={16} weight="700" accessibilityRole="header" style={styles.agendaTitle}>
                {isTodaySelected ? 'Dagens vagter' : capitalize(dateLabel(selection, { weekday: 'long', month: 'long' }))}
              </Txt>
              {selectedShifts.length > 0 && (
                <Txt size={12} weight="500" color={colors.muted}>{selectedShifts.length} {selectedShifts.length === 1 ? 'vagt' : 'vagter'}</Txt>
              )}
            </Row>
            {canEditAvailability && (
              <View style={[cardStyles.divider, styles.availability]}>
                <Row gap={8} style={styles.availabilityRow}>
                  <Row gap={7} style={styles.availabilityStatus} accessibilityLiveRegion="polite">
                    {selectedUnavailable && <View style={styles.unavailableMarker} aria-hidden />}
                    <Txt size={13} weight="600" color={selectedUnavailable ? colors.ink : colors.muted} style={styles.availabilityLabel}>
                      {selectedUnavailable ? 'Utilgængelig hele dagen' : 'Tilgængelighed'}
                    </Txt>
                  </Row>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: availabilityBusy || (live && !ownPreferences) }}
                    disabled={availabilityBusy || (live && !ownPreferences)}
                    onPress={() => { void changeAvailability(); }}
                    style={({ pressed }) => [styles.availabilityButton, pressed && styles.pressed]}
                  >
                    <Txt size={13} weight="600" color={colors.accent} selectable={false}>
                      {availabilityBusy ? 'Gemmer…' : selectedUnavailable ? 'Fjern markering' : 'Markér utilgængelig'}
                    </Txt>
                  </Pressable>
                </Row>
                {selectedUnavailable && selectedShifts.length > 0 && (
                  <Txt size={12} color={colors.muted} style={styles.availabilityNote}>
                    Planlagte vagter gælder stadig.
                  </Txt>
                )}
                {availabilityError?.date === selection && (
                  <Txt accessibilityRole="alert" size={12} color={colors.danger} style={styles.availabilityNote}>
                    {availabilityError.message}
                  </Txt>
                )}
                {live && preferences.error && !ownPreferences && <Txt accessibilityRole="alert" size={12} color={colors.danger} style={styles.availabilityNote}>{preferences.error}</Txt>}
              </View>
            )}
            <View style={cardStyles.divider}>
              <ScheduleFeedback loading={schedule.loading && !schedule.data} error={schedule.error} onRetry={schedule.refresh} />
              {selectedShifts.map((shift, index) => (
                <View key={shift.id} style={index > 0 && cardStyles.divider}>
                  <ShiftRow shift={shift} publishedSite={publishedSites.get(shift.id)} publishedEntry={publishedEntries.get(shift.id)} publishedToday={live ? today : undefined} showDate={false} dateTile />
                </View>
              ))}
              {selectedShifts.length === 0 && (!live || (schedule.data && !schedule.error)) && (
                <EmptyState compact icon="calendar" title="Ingen vagter den dag" />
              )}
            </View>
          </Animated.View>
        </>
      )}
    </ScrollView>
  );

  return (
    <>
      <FlowScreen backgroundTop={backgroundTop}>{calendar}</FlowScreen>
      {!open && (
        <CalendarMonthPicker
          year={picker.year}
          selectedMonth={monthKey}
          visible={picker.visible}
          onYearChange={offset => setPicker(previous => ({ ...previous, year: previous.year + offset }))}
          onSelect={targetMonth => {
            setSelection(({ date }) => ({ date: selectDayInMonth(date, targetMonth), swipeDirection: 0 }));
            closePicker();
          }}
          onDismiss={closePicker}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 16 },
  scopeBar: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: cardColors.border },
  scopeTab: {
    flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, paddingHorizontal: 6, borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  scopeIndicator: { position: 'absolute', start: 0, bottom: 0, width: '50%', height: 2, backgroundColor: colors.accent },
  centered: { textAlign: 'center' },
  pressed: { backgroundColor: colors.paper },
  calendarPanel: { paddingHorizontal: 12, paddingTop: 11, paddingBottom: 12, gap: 9 },
  periodHeader: { paddingHorizontal: 2, justifyContent: 'space-between' },
  periodText: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', borderRadius: 7 },
  periodTitle: { flexShrink: 1, letterSpacing: -.45 },
  todayButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 9, borderRadius: 7 },
  grid: { gap: 3, overflow: 'hidden', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: 8 },
  weeks: { gap: 3 },
  weekdays: { marginBottom: 2 },
  weekday: { flex: 1, minWidth: 0, textAlign: 'center' },
  week: { alignItems: 'stretch' },
  day: {
    flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 4, borderWidth: 1, borderColor: 'transparent', borderRadius: 8, borderCurve: 'continuous',
  },
  todayCell: { borderColor: '#a5b6af' },
  unavailableDay: { backgroundColor: colors.warningSoft },
  selectedDay: { borderColor: colors.ink },
  daySelection: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 7, borderCurve: 'continuous', backgroundColor: colors.ink },
  markers: { height: 8, justifyContent: 'center' },
  marker: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent },
  selectedMarker: { backgroundColor: colors.white },
  unavailableMarker: { width: 8, height: 2, borderRadius: 1, backgroundColor: colors.warning },
  selectedUnavailableMarker: { backgroundColor: '#f2cc88' },
  agendaHeading: {
    justifyContent: 'space-between', flexWrap: 'wrap', minHeight: 46,
    paddingHorizontal: 14, paddingVertical: 9, backgroundColor: cardColors.section,
  },
  agendaTitle: { flexShrink: 1, letterSpacing: -.35 },
  availability: { paddingLeft: 14, paddingRight: 9 },
  availabilityRow: { flexWrap: 'wrap', justifyContent: 'space-between' },
  availabilityStatus: { flexShrink: 1, minHeight: 44 },
  availabilityLabel: { flexShrink: 1 },
  availabilityButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 5, borderRadius: 7 },
  availabilityNote: { paddingBottom: 8, paddingRight: 5 },
});
