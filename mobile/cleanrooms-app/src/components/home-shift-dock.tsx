import { router } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useReduceMotionPreference } from '@/components/motion-preference';
import { PressFeedback } from '@/components/press-feedback';
import { Icon, Txt } from '@/components/ui';
import { cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { addDays, dateLabel, workingIntervals, type Shift, type TimeEntry } from '@/domain/model';
import { demoNow, useAppData } from '@/state/app-store';
import { elapsedSeconds, monotonicNow } from '@/state/attendance-runtime';

function durationLabel(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor(seconds / 60) % 60;
  const digits = (value: number) => String(value).padStart(2, '0');
  return {
    display: days ? `${days} d ${hours % 24} t` : `${digits(hours)}:${digits(minutes)}:${digits(seconds % 60)}`,
    spoken: days
      ? `${days} ${days === 1 ? 'dag' : 'dage'} og ${hours % 24} ${hours % 24 === 1 ? 'time' : 'timer'}`
      : `${hours ? `${hours} ${hours === 1 ? 'time' : 'timer'} og ` : ''}${minutes} ${minutes === 1 ? 'minut' : 'minutter'}`,
  };
}

function countdownLabel(seconds: number) {
  if (seconds < 60) return { display: 'Under 1 min', spoken: 'under 1 minut' };
  const roundedSeconds = Math.ceil(seconds / 60) * 60;
  const duration = durationLabel(roundedSeconds);
  if (roundedSeconds >= 86_400) return duration;
  const hours = Math.floor(roundedSeconds / 3_600);
  const minutes = (roundedSeconds / 60) % 60;
  return {
    ...duration,
    display: hours ? `${hours} t ${String(minutes).padStart(2, '0')} min` : `${minutes} min`,
  };
}

function ShiftStatusIcon({ running, paused, focused }: { running: boolean; paused: boolean; focused: boolean }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (running && focused) {
      opacity.set(withRepeat(withTiming(0.65, {
        duration: 1_250,
        easing: Easing.inOut(Easing.sin),
        reduceMotion: ReduceMotion.System,
      }), -1, true, undefined, ReduceMotion.System));
    }
    return () => {
      cancelAnimation(opacity);
      opacity.set(1);
    };
  }, [focused, opacity, running]);
  const motion = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const iconColor = running ? colors.success : paused ? colors.warning : colors.ink;

  return (
    <View style={styles.icon}>
      <Animated.View style={motion}>
        <Icon name={running ? 'clock' : paused ? 'pause' : 'calendar'} size={20} color={iconColor} />
      </Animated.View>
    </View>
  );
}

export function HomeShiftDock({ shift, siteName, start, today, entry, live = false, serverClock }: {
  shift: Shift;
  siteName: string;
  start: number;
  today: string;
  entry?: TimeEntry;
  live?: boolean;
  serverClock?: { workedSeconds?: number; measuredAt?: number; receivedAtMonotonic?: number };
}) {
  const { state } = useAppData();
  const focused = useIsFocused();
  const reduceMotion = useReduceMotionPreference();
  const { fontScale, width } = useWindowDimensions();
  const [realNow, setRealNow] = useState(Date.now);
  const [elapsedNow, setElapsedNow] = useState(monotonicNow);
  const running = entry?.status === 'running';
  const paused = entry?.status === 'paused';
  const now = live ? realNow : demoNow(state, realNow);
  const counting = running || (!entry && start > now);

  useEffect(() => {
    if (!focused || !counting) return;
    const tick = () => { setRealNow(Date.now()); setElapsedNow(monotonicNow()); };
    const refresh = setTimeout(tick, 0);
    const timer = setInterval(tick, 1_000);
    return () => {
      clearTimeout(refresh);
      clearInterval(timer);
    };
  }, [counting, focused, shift.id, state.demoStartedAt]);

  const waiting = !entry && start > now;
  const statusKey = running ? 'running' : paused ? 'paused' : waiting ? 'waiting' : 'scheduled';
  const previousStatus = useRef({ key: statusKey, focused });
  const statusOpacity = useSharedValue(1);
  const statusIconStyle = useAnimatedStyle(() => ({ opacity: statusOpacity.get() }));
  const statusLabelStyle = useAnimatedStyle(() => ({ opacity: statusOpacity.get() }));

  useLayoutEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = { key: statusKey, focused };
    if (!focused || reduceMotion || !previous.focused) {
      cancelAnimation(statusOpacity);
      statusOpacity.set(1);
    } else if (previous.key !== statusKey) {
      statusOpacity.set(0.75);
      statusOpacity.set(withTiming(1, {
        duration: 170,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.Never,
      }));
    }
    return () => cancelAnimation(statusOpacity);
  }, [focused, reduceMotion, statusKey, statusOpacity]);

  const workedUntil = paused ? Date.parse(entry.pauses.at(-1)?.start ?? entry.clockIn) : now;
  const serverElapsed = serverClock && elapsedSeconds({ version: 1, status: running ? 'running' : 'paused', clockIn: null, clockOut: null, pauseAt: null, ...serverClock }, elapsedNow);
  const elapsed = live
    ? (serverElapsed ?? 0) * 1_000
    : entry
    ? workingIntervals(entry, workedUntil).reduce((total, interval) => total + interval.end - interval.start, 0)
    : 0;
  const duration = waiting ? countdownLabel((start - now) / 1_000) : durationLabel(Math.floor(elapsed / 1_000));
  const status = running ? 'Vagt i gang' : paused ? 'På pause' : 'Næste vagt';
  const counterLabel = entry ? 'Arbejdet' : waiting ? 'Starter om' : 'Planlagt fra';
  const statusColor = running ? colors.success : paused ? colors.warning : colors.muted;
  const date = dateLabel(shift.date, { weekday: 'short' });
  const visibleDate = shift.date === today ? 'I dag' : shift.date === addDays(today, 1) ? 'I morgen' : date;
  const compactWidth = fontScale > 1.3 || width < 350;

  return (
    <PressFeedback
      accessibilityRole="button"
      accessibilityLabel={`${status}, ${siteName}, ${date}, ${shift.start} til ${shift.end}. ${counterLabel} ${entry || waiting ? duration.spoken : shift.start}.`}
      accessibilityHint="Åbner vagtdetaljer"
      haptic="light"
      onPress={() => router.push({ pathname: '/shift/[id]', params: { id: shift.id } })}
      style={cardStyles.raisedFrame}
    >
      {({ pressed }) => <View style={[cardStyles.raisedSurface, styles.card, pressed && styles.pressed]}>
        <Animated.View style={statusIconStyle}>
          <ShiftStatusIcon running={running} paused={paused} focused={focused} />
        </Animated.View>
        <View style={[styles.cardContent, compactWidth && styles.stacked]}>
          <View style={styles.details}>
            <Animated.View style={statusLabelStyle}>
              <Txt size={12} weight={running || paused ? '600' : '500'} color={statusColor}>{status}</Txt>
            </Animated.View>
            <Txt size={15} weight="600" style={styles.site}>{siteName}</Txt>
            <Txt size={12} color={colors.muted}>{visibleDate} · {shift.start}–{shift.end}</Txt>
          </View>
          <View style={[styles.counter, compactWidth && styles.stackedCounter]}>
            <Txt size={11} color={colors.muted}>{counterLabel}</Txt>
            <Txt size={17} weight="600" color={running ? colors.success : colors.ink} style={styles.digits}>
              {live && entry && serverElapsed == null ? '—' : entry || waiting ? duration.display : shift.start}
            </Txt>
          </View>
        </View>
        <View style={styles.chevron}>
          <Icon name="chevron-right" size={12} color={colors.muted} />
        </View>
      </View>}
    </PressFeedback>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  pressed: { backgroundColor: colors.paper },
  icon: { width: 28, height: 36, alignItems: 'center', justifyContent: 'center' },
  chevron: { width: 12, height: 20, alignItems: 'center', justifyContent: 'center' },
  cardContent: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  details: { flex: 1, minWidth: 0 },
  site: { lineHeight: 21, letterSpacing: -0.15 },
  counter: { alignItems: 'flex-end', minWidth: 73 },
  digits: { lineHeight: 23 },
  stacked: { flexDirection: 'column', alignItems: 'stretch', gap: 3 },
  stackedCounter: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 },
});
