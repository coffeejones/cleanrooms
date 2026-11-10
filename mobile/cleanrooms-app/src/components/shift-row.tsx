import { router } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { PublishedShift } from '@/auth/mobile-auth-api';
import { colors } from '@/constants/palette';
import { dateLabel, type Shift } from '@/domain/model';
import { useAppData } from '@/state/app-store';
import { useReduceMotionPreference } from './motion-preference';
import { Icon, LiveClock, Row, Txt } from './ui';

export function ShiftRow({ shift, publishedSite, publishedEntry, publishedToday, showDate = true, dateTile = false, endedWithoutEntry = false }: {
  shift: Shift;
  publishedSite?: PublishedShift['site'];
  publishedEntry?: PublishedShift['entry'];
  publishedToday?: string;
  showDate?: boolean;
  dateTile?: boolean;
  endedWithoutEntry?: boolean;
}) {
  const { state } = useAppData();
  const focused = useIsFocused();
  const reduceMotion = useReduceMotionPreference();
  const homeTile = dateTile && showDate;
  const pressScale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: pressScale.get() }] }));

  useEffect(() => {
    cancelAnimation(pressScale);
    pressScale.set(1);
    return () => cancelAnimation(pressScale);
  }, [focused, homeTile, pressScale, reduceMotion, shift.id]);

  function animatePress(pressed: boolean) {
    if (!homeTile || reduceMotion || !focused) {
      cancelAnimation(pressScale);
      pressScale.set(1);
      return;
    }
    pressScale.set(withTiming(pressed ? 0.99 : 1, {
      duration: pressed ? 90 : 160,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.Never,
    }));
  }

  const site = publishedSite ?? state.sites.find(place => place.id === shift.siteId);
  const entry = publishedSite ? publishedEntry : state.entries.find(record => record.shiftId === shift.id);
  const active = entry && (entry.status === 'running' || entry.status === 'paused');
  const paused = entry?.status === 'paused';
  const activeColor = paused ? colors.warning : colors.success;
  const today = shift.date === (publishedToday ?? state.today);
  const pending = publishedSite ? undefined : state.requests.find(request => request.shiftId === shift.id && request.status === 'pending');
  const day = dateLabel(shift.date);
  const dateStamp = today ? 'I dag' : dateLabel(shift.date, { weekday: 'short' });
  const weekday = dateTile ? dateLabel(shift.date, { weekday: 'short', day: undefined, month: undefined }) : '';
  const tileWeekday = today ? 'I dag' : weekday.charAt(0).toLocaleUpperCase('da-DK') + weekday.slice(1);
  const [dateNumber, dateMonth] = day.split(/\s+/, 2);
  const spokenDay = dateTile ? dateLabel(shift.date, { weekday: 'long' }) : day;
  const missed = dateTile && endedWithoutEntry && !entry;
  const status = active ? (paused ? 'På pause' : 'I gang') : entry?.clockOut ? 'Afsluttet' : '';
  const requestStatus = pending && (pending.kind === 'leave' ? 'Friønske afventer' : 'Vagtanmodning afventer');
  const siteLabel = site?.name ?? (dateTile ? 'Arbejdssted' : '');
  const label = [
    spokenDay,
    shift.start + ' til ' + shift.end,
    siteLabel,
    missed ? 'Ikke registreret' : status,
    requestStatus,
  ].filter(Boolean).join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => animatePress(true)}
      onPressOut={() => animatePress(false)}
      onPress={() => router.push({ pathname: '/shift/[id]', params: { id: shift.id } })}
      style={({ pressed }) => ({
        paddingVertical: dateTile ? 16 : 9,
        paddingHorizontal: dateTile ? 16 : undefined,
        minHeight: dateTile ? 84 : 57,
        justifyContent: 'center',
        opacity: pressed && !dateTile ? .6 : 1,
        backgroundColor: pressed && dateTile ? colors.paper : undefined,
      })}
    >
      <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: dateTile ? 16 : 12 }, pressStyle]}>
        {showDate && dateTile && (
          <View style={{ flexBasis: 52, flexShrink: 0 }}>
            <Txt size={11} weight="500" color={today ? colors.accent : colors.muted} style={{ lineHeight: 15 }}>
              {tileWeekday}
            </Txt>
            <View style={{ alignItems: 'flex-start' }}>
              <Txt size={21} weight="600" color={colors.ink} style={{ lineHeight: 24, letterSpacing: -.5 }}>
                {dateNumber}
              </Txt>
              <Txt size={11} color={colors.muted} style={{ lineHeight: 13 }}>
                {dateMonth}
              </Txt>
            </View>
          </View>
        )}
        {showDate && !dateTile && (
          <View style={{ flexBasis: 76, flexShrink: 1 }}>
            <Txt size={12} weight={today ? '500' : '400'} color={today ? colors.accent : colors.muted}>
              {dateStamp}
            </Txt>
          </View>
        )}
        <View style={{ flex: 1, minWidth: dateTile ? 0 : undefined, gap: dateTile ? 3 : 2 }}>
          {dateTile ? (
            <>
              <Txt size={17} weight="600" style={{ lineHeight: 23, letterSpacing: -.25 }}>{shift.start}–{shift.end}</Txt>
              <Txt size={13} color={colors.muted} numberOfLines={2} style={{ lineHeight: 18 }}>{siteLabel}</Txt>
            </>
          ) : (
            <>
              <Txt size={15} weight="500">{shift.start}–{shift.end}</Txt>
              <Txt size={12} color={colors.muted} numberOfLines={1}>{site?.name}{!shift.personId ? ' · ' + shift.role : ''}</Txt>
            </>
          )}
          {missed && <Txt size={11} color={colors.warning}>Ikke registreret</Txt>}
          {requestStatus && <Txt size={11} color={colors.warning}>{requestStatus}</Txt>}
        </View>
        <Row gap={7} style={homeTile ? { minHeight: 20 } : undefined}>
          {entry?.clockOut ? (
            <Icon name="check-circle" size={homeTile ? 16 : 17} color={colors.success} />
          ) : active ? (
            <Row gap={5}>
              {paused
                ? <Icon name="pause" size={homeTile ? 16 : 14} color={activeColor} />
                : <LiveClock size={homeTile ? 16 : 14} color={activeColor} />}
              <Txt size={11} weight="500" color={activeColor}>{status}</Txt>
            </Row>
          ) : !shift.personId && !pending ? (
            <Txt size={11} weight="600" color={colors.accent}>Ledig</Txt>
          ) : null}
          <View style={homeTile ? { width: 14, height: 20, alignItems: 'center', justifyContent: 'center' } : undefined}>
            <Icon name="chevron-right" size={dateTile ? 12 : 14} color={colors.muted} />
          </View>
        </Row>
      </Animated.View>
    </Pressable>
  );
}
