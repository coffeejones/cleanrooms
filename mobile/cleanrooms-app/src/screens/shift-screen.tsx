import { Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import type { NavigationProp } from 'expo-router/react-navigation';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { Easing, FadeInUp, ReduceMotion, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FlowScreen } from '@/components/flow-screen';
import { useReduceMotionPreference } from '@/components/motion-preference';
import { ShiftAddressRow } from '@/components/shift-address-row';
import { ShiftActionButton, ShiftConfirmation, type ShiftConfirmationKind } from '@/components/shift-confirmation';
import { ShiftTimeChange } from '@/components/shift-time-change';
import { EmptyState, Icon, Row, Surface, Txt } from '@/components/ui';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { clockInAvailability, clockTimeLabel, copenhagenDate, currency, dateLabel, minutesLabel, shiftInterval, shiftPay, workedMinutes, type Result, type TimeEntry } from '@/domain/model';
import { useApp } from '@/state/app-store';

type ShiftParams = { id: string; action?: string };
const disclosureTiming = { duration: 160, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.Never };
const descriptionEnter = FadeInUp.duration(disclosureTiming.duration)
  .easing(disclosureTiming.easing)
  .reduceMotion(disclosureTiming.reduceMotion)
  .withInitialValues({ opacity: 0.55, transform: [{ translateY: -4 }] });

function registrationStatus(entry: TimeEntry | undefined, ended: boolean) {
  if (!entry) return ended ? 'Ikke registreret' : 'Planlagt';
  if (entry.clockOut) return entry.status === 'approved' ? 'Godkendt' : 'Afsluttet';
  return entry.status === 'paused' ? 'På pause' : 'I gang';
}

function DetailRow({ icon, label, value, expanded, complete = false, onPress }: {
  icon: string;
  label: string;
  value?: string;
  expanded?: boolean;
  complete?: boolean;
  onPress: () => void;
}) {
  const chevron = expanded === undefined ? 'chevron-right' : 'chevron-down';
  const reduceMotion = useReduceMotionPreference();
  const rotation = expanded ? '180deg' : '0deg';
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: reduceMotion ? rotation : withTiming(rotation, disclosureTiming) }],
  }), [reduceMotion, rotation]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      accessibilityLabel={value ? `${label}, ${value}${complete ? ' udført' : ''}` : label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 56,
        paddingVertical: 14,
        opacity: pressed ? 0.55 : 1,
        justifyContent: 'center',
      })}
    >
      <Row gap={12}>
        <Icon name={icon} size={18} color={colors.muted} />
        <Txt size={15} weight="600" style={{ flex: 1 }}>{label}</Txt>
        {value && <Txt size={12} color={colors.muted} style={{ flexShrink: 1, textAlign: 'right' }}>{value}</Txt>}
        <Row gap={6}>
          {complete && <Icon name="check" size={12} color={colors.success} />}
          <Animated.View style={chevronStyle}>
            <Icon name={chevron} size={14} color={colors.muted} />
          </Animated.View>
        </Row>
      </Row>
    </Pressable>
  );
}

function ShiftMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 4, flexGrow: 1, flexBasis: '44%' }}>
      <Txt size={12} color={colors.muted}>{label}</Txt>
      <Txt size={16} weight="600">{value}</Txt>
    </View>
  );
}

export default function ShiftScreen() {
  const { id, action } = useLocalSearchParams<ShiftParams>();
  const navigation = useNavigation<NavigationProp<{ 'shift/[id]': ShiftParams }>>();
  const { state, now, actions } = useApp();
  const reduceMotion = useReduceMotionPreference();
  const insets = useSafeAreaInsets();
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [manualForm, setManualForm] = useState<ShiftConfirmationKind | null>(null);
  const [error, setError] = useState('');

  const shift = state.shifts.find((item) => item.id === id);
  const mine = shift?.personId === state.selfId;
  const entry = state.entries.find((item) => item.shiftId === id);
  const active = mine && !entry?.clockOut && (entry?.status === 'running' || entry?.status === 'paused');
  const requestedFinish = action === 'clock-out';
  const form = requestedFinish && active ? 'clock-out' : manualForm;

  useEffect(() => {
    // A stale link should open the details without scheduling a later confirmation.
    if (requestedFinish && !active) navigation.setParams({ action: undefined });
  }, [active, navigation, requestedFinish]);

  if (!shift || (shift.personId && !mine)) {
    return <EmptyState title="Vagten blev ikke fundet" />;
  }

  const site = state.sites.find((item) => item.id === shift.siteId);
  const pending = state.requests.find((item) => item.shiftId === shift.id && item.status === 'pending');
  const { start, end } = shiftInterval(shift);
  const finished = Boolean(entry?.clockOut);
  const availability = clockInAvailability(state, shift, now);
  const canRequest = !pending && !entry && start > now;
  const tasks = mine ? shift.checklist : [];
  const completed = new Set(entry?.completedTaskIds);
  const done = tasks.filter(task => completed.has(task.id)).length;
  const pay = shiftPay(shift, entry);
  const status = mine ? registrationStatus(entry, now >= end) : pending ? 'Anmodet' : 'Ledig';
  const paused = entry?.status === 'paused';
  const statusColor = paused ? colors.warning : finished || active ? colors.success : colors.muted;
  const duration = entry ? minutesLabel(workedMinutes(entry, now)) : '';
  const showClockIn = mine && !entry && now < end;
  const showFooter = active || showClockIn || (!mine && canRequest);
  const showDescription = Boolean(shift.description || tasks.length);
  const showLeave = mine && canRequest;
  const date = dateLabel(shift.date, { weekday: 'long', month: 'long' });
  const shiftTimes = `${shift.start}–${shift.end}`;
  const shiftContext = [shift.role, shift.breakMinutes > 0 ? `${shift.breakMinutes} min planlagt pause` : '']
    .filter(Boolean).join(' · ');
  const clockInHint = availability.opensAt > now
    ? `Stempl ind ${shift.date === copenhagenDate(now) ? 'fra' : `${dateLabel(shift.date)} fra`} kl. ${clockTimeLabel(availability.opensAt)}`
    : availability.reason;

  function openForm(kind: ShiftConfirmationKind) {
    setError('');
    setManualForm(kind);
  }

  function cancelForm() {
    if (requestedFinish) navigation.setParams({ action: undefined });
    setManualForm(null);
  }

  function showResult(result: Result) {
    setError(result.ok ? '' : result.error ?? 'Prøv igen.');
  }

  function submitForm(comment: string, signal: AbortSignal): Result | Promise<Result> {
    if (form === 'clock-in') return actions.clockIn(id, signal);
    if (form === 'clock-out') {
      const result = actions.clockOut(id, comment);
      // Keep the sheet open for feedback after a shortcut no longer has an active shift.
      if (result.ok && requestedFinish) setManualForm(form);
      return result;
    }
    if (form === 'leave') return actions.requestLeave(id, comment);
    return { ok: false };
  }

  return (
    <View style={{ flex: 1, backgroundColor: cardColors.canvas }}>
      <Stack.Screen options={{ title: mine ? 'Din vagt' : 'Ledig vagt' }} />
      <FlowScreen>
        <ScrollView
          style={{ flex: 1 }}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 16 }}
        >
          <Surface style={[cardStyles.listSurface, { gap: 20, padding: 18 }]}>
            <View style={{ gap: 10 }}>
              <Row gap={12} style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <Txt size={13} weight="500" color={colors.muted} style={{ flexShrink: 1 }}>{date}</Txt>
                <Row gap={6} style={{ flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Row gap={5}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
                    <Txt size={12} weight="500" color={colors.muted}>{status}</Txt>
                  </Row>
                  <ShiftTimeChange shift={shift} />
                </Row>
              </Row>
              <Txt size={32} weight="600" style={{ letterSpacing: -1.2 }}>{shiftTimes}</Txt>
            </View>
            <View style={{ gap: 7 }}>
              <Txt size={19} weight="600" accessibilityRole="header" style={{ letterSpacing: -0.35 }}>{site?.name ?? 'Arbejdssted'}</Txt>
              <ShiftAddressRow address={site?.address} />
              {!!shiftContext && <Txt size={13} color={colors.muted} style={{ lineHeight: 20 }}>{shiftContext}</Txt>}
            </View>
            <View style={[cardStyles.divider, { gap: 16, paddingTop: 18 }]}>
              <Row gap={16} style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {entry && <ShiftMetric label="Stemplet ind" value={clockTimeLabel(entry.clockIn)} />}
                {entry?.clockOut && <ShiftMetric label="Stemplet ud" value={clockTimeLabel(entry.clockOut)} />}
                {entry && <ShiftMetric label="Arbejdstid" value={duration} />}
                <ShiftMetric label={finished ? 'Løn før skat' : 'Forventet løn før skat'} value={currency(pay.totalCents)} />
              </Row>
              {!!entry?.pauses.length && (
                <Txt size={12} color={colors.muted}>
                  {`Pauser · ${entry.pauses.map((pause) => pause.end
                    ? `${clockTimeLabel(pause.start)}–${clockTimeLabel(pause.end)}`
                    : `fra ${clockTimeLabel(pause.start)}`).join(' · ')}`}
                </Txt>
              )}
              {active && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => showResult(paused ? actions.resume(id) : actions.pause(id))}
                  style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: colors.white, borderWidth: 1, borderColor: cardColors.border, borderRadius: 8, borderCurve: 'continuous', opacity: pressed ? 0.65 : 1 })}
                >
                  <Row gap={8}>
                    <Icon name={paused ? 'play' : 'pause'} size={15} color={colors.ink} />
                    <Txt size={14} weight="600">{paused ? 'Fortsæt vagt' : 'Hold pause'}</Txt>
                  </Row>
                </Pressable>
              )}
              {(pending || entry?.status === 'submitted') && (
                <Txt size={12} color={colors.muted}>
                  {pending?.kind === 'leave' ? 'Friønske afventer godkendelse' : 'Afventer godkendelse'}
                </Txt>
              )}
            </View>
          </Surface>

          {(showDescription || showLeave || !!entry?.comment) && (
            <Surface style={[cardStyles.listSurface, { paddingVertical: 0, paddingHorizontal: 18 }]}>
              {showDescription && (
                <>
                  <DetailRow
                    icon="file"
                    label="Beskrivelse"
                    value={tasks.length ? `${done} af ${tasks.length} opgaver` : undefined}
                    complete={tasks.length > 0 && done === tasks.length}
                    expanded={descriptionOpen}
                    onPress={() => setDescriptionOpen((open) => !open)}
                  />
                  {descriptionOpen && (
                    <Animated.View entering={reduceMotion ? undefined : descriptionEnter} style={{ paddingTop: 2, paddingBottom: 18, gap: 10 }}>
                      {!!shift.description && <Txt size={15} style={{ lineHeight: 23 }}>{shift.description}</Txt>}
                      {tasks.map((task, index) => {
                        const checked = completed.has(task.id);
                        return (
                          <Pressable
                            key={task.id}
                            accessibilityRole="checkbox"
                            accessibilityLabel={task.text}
                            accessibilityState={{ checked, disabled: !entry }}
                            disabled={!entry}
                            onPress={() => showResult(actions.toggleTask(id, task.id))}
                            style={[
                              { minHeight: 44, paddingVertical: 8, justifyContent: 'center' },
                              index === 0 && !!shift.description?.trim() && cardStyles.divider,
                            ]}
                          >
                            <Row gap={10}>
                              <View style={{
                                width: 21, height: 21, borderRadius: 5, alignItems: 'center', justifyContent: 'center',
                                borderWidth: checked ? 0 : 1, borderColor: colors.muted,
                                backgroundColor: checked ? colors.accent : colors.white,
                              }}>
                                {checked && <Icon name="check" size={14} color={colors.white} />}
                              </View>
                              <Txt size={14} color={checked || !entry ? colors.muted : colors.ink} style={{ flex: 1 }}>
                                {task.text}
                              </Txt>
                            </Row>
                          </Pressable>
                        );
                      })}
                      {tasks.length > 0 && !entry && (
                        <Txt size={12} color={colors.muted}>Stempl ind for at afkrydse opgaver.</Txt>
                      )}
                    </Animated.View>
                  )}
                </>
              )}
              {showLeave && (
                <View style={showDescription && cardStyles.divider}>
                  <DetailRow icon="moon" label="Ønsk fri fra vagten" onPress={() => openForm('leave')} />
                </View>
              )}
              {!!entry?.comment && (
                <View style={[{ paddingVertical: 14, gap: 4 }, showDescription && cardStyles.divider]}>
                  <Txt size={13} weight="600" color={colors.muted}>Din kommentar</Txt>
                  <Txt size={14}>{entry.comment}</Txt>
                </View>
              )}
            </Surface>
          )}
          {!!error && !showFooter && <Txt accessibilityRole="alert" size={13} color={colors.danger}>{error}</Txt>}
        </ScrollView>
      </FlowScreen>

      {showFooter && (
        <View style={{
          backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.line, gap: 8,
          boxShadow: '0 -3px 12px rgba(0, 30, 43, 0.035)',
          paddingTop: 12, paddingBottom: Math.max(12, insets.bottom),
          paddingLeft: Math.max(16, insets.left), paddingRight: Math.max(16, insets.right),
        }}>
          {!!error && <Txt accessibilityRole="alert" size={13} color={colors.danger}>{error}</Txt>}
          {showClockIn && !availability.allowed && (
            <Txt size={12} color={colors.muted} style={{ textAlign: 'center' }}>{clockInHint}</Txt>
          )}
          {active ? (
            <ShiftActionButton label="Stempl ud" onPress={() => openForm('clock-out')} />
          ) : showClockIn ? (
            <ShiftActionButton label="Stempl ind" disabled={!availability.allowed} onPress={() => openForm('clock-in')} />
          ) : (
            <ShiftActionButton label="Anmod om vagten" onPress={() => showResult(actions.claimShift(id))} />
          )}
        </View>
      )}

      <ShiftConfirmation
        kind={form}
        locationCheck={site?.geofence ? 'required' : undefined}
        summary={form === 'leave' ? 'Vagten gælder, indtil friønsket er godkendt.'
          : form === 'clock-out' ? `${duration} arbejdstid ekskl. pauser`
          : [site?.name, shiftTimes].filter(Boolean).join(' · ')}
        onConfirm={submitForm}
        onDismiss={cancelForm}
      />
    </View>
  );
}
