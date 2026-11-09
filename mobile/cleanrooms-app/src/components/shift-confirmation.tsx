import { BottomSheet, RNHostView, ScrollView } from '@expo/ui';
import * as Haptics from 'expo-haptics';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { AccessibilityInfo, ActivityIndicator, Keyboard, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useReduceMotionPreference } from '@/components/motion-preference';
import { Icon, Txt } from '@/components/ui';
import { colors } from '@/constants/palette';
import type { Result } from '@/domain/model';

export type ShiftConfirmationKind = 'clock-in' | 'clock-out' | 'leave';
type StampKind = Exclude<ShiftConfirmationKind, 'leave'>;
type Confirm = (comment: string, signal: AbortSignal) => Result | Promise<Result>;
type LocationCheck = 'required';

const badgeTiming = { duration: 240, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.Never };

const copy = {
  'clock-in': { title: 'Stempl ind?', confirm: 'Bekræft indstempling' },
  'clock-out': { title: 'Stempl ud?', confirm: 'Bekræft udstempling' },
  leave: { title: 'Anmod om fri', confirm: 'Send friønske' },
};

export function ShiftActionButton({ label, onPress, disabled = false, secondary = false, busy = false }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  busy?: boolean;
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: secondary ? 44 : 50,
        paddingHorizontal: 16, paddingVertical: 10,
        flexDirection: 'row', gap: 8,
        alignItems: 'center', justifyContent: 'center',
        borderRadius: 12, borderCurve: 'continuous',
        backgroundColor: secondary ? 'transparent' : inactive ? colors.paper : colors.ink,
        opacity: pressed ? 0.78 : 1,
      })}
    >
      {busy && <ActivityIndicator size="small" color={colors.muted} aria-hidden />}
      <Txt selectable={false} size={15} weight="600" color={secondary || inactive ? colors.muted : colors.white} style={{ textAlign: 'center', flexShrink: 1 }}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function ShiftConfirmation({ kind, summary, onConfirm, onDismiss, locationCheck }: {
  kind: ShiftConfirmationKind | null;
  summary: string;
  onConfirm: Confirm;
  onDismiss: () => void;
  locationCheck?: LocationCheck;
}) {
  const { height, fontScale } = useWindowDimensions();
  const needsScroll = height < 620 || fontScale > 1.3;
  const requestRef = useRef<AbortController | null>(null);

  useLayoutEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, [kind]);

  function dismiss() {
    requestRef.current?.abort();
    requestRef.current = null;
    onDismiss();
  }

  return (
    <BottomSheet
      isPresented={kind !== null}
      onDismiss={dismiss}
      snapPoints={needsScroll ? ['full'] : undefined}
      containerColor={colors.surface}
      contentPadding={{ top: 24, bottom: 18, left: 20, right: 20 }}
    >
      {kind && (
        <ConfirmationForm
          key={kind}
          {...{ kind, summary, onConfirm, needsScroll, requestRef }}
          onDismiss={dismiss}
          locationCheck={kind === 'clock-in' ? locationCheck : undefined}
        />
      )}
    </BottomSheet>
  );
}

function ConfirmationForm({ kind, summary, onConfirm, onDismiss, needsScroll, locationCheck, requestRef }: {
  kind: ShiftConfirmationKind;
  summary: string;
  onConfirm: Confirm;
  onDismiss: () => void;
  needsScroll: boolean;
  locationCheck?: LocationCheck;
  requestRef: RefObject<AbortController | null>;
}) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [stampResult, setStampResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);
  const leave = kind === 'leave';
  const inputLabel = leave ? 'Begrundelse' : 'Kommentar til planlæggeren (valgfri)';

  async function submit() {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true);
    let result: Result;
    try {
      result = await onConfirm(comment, controller.signal);
    } catch {
      result = { ok: false, error: 'Handlingen kunne ikke gennemføres. Prøv igen.' };
    }
    if (controller.signal.aborted) return;
    setPending(false);

    if (leave) {
      if (result.ok) onDismiss();
      else {
        requestRef.current = null;
        setError(result.error ?? 'Prøv igen.');
      }
      return;
    }

    Keyboard.dismiss();
    setStampResult(result);
    if (process.env.EXPO_OS === 'ios') {
      void Haptics.notificationAsync(result.ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }

  const content = (
    <RNHostView matchContents={{ vertical: true }}>
      <View collapsable={false} style={confirmationStyles.hostContent}>
        {!leave && stampResult ? (
          <StampFeedback kind={kind} result={stampResult} onDismiss={onDismiss} onRetry={() => {
            requestRef.current = null;
            setStampResult(null);
          }} />
        ) : (
          <View style={confirmationStyles.form}>
            <View style={confirmationStyles.heading}>
              <Txt size={23} weight="700" accessibilityRole="header">{copy[kind].title}</Txt>
              <Txt size={15} color={colors.muted}>{summary}</Txt>
              {locationCheck && (
                <Txt size={14} color={colors.muted}>
                  Appen tjekker din afstand til arbejdsstedet, når du bekræfter.
                </Txt>
              )}
            </View>
            {kind !== 'clock-in' && (
              <View style={confirmationStyles.field}>
                <Txt size={14} weight="600">{inputLabel}</Txt>
                <TextInput
                  accessibilityLabel={inputLabel}
                  multiline
                  placeholder={leave ? 'Skriv din begrundelse' : 'Tilføj kommentar'}
                  placeholderTextColor={colors.muted}
                  onChangeText={setComment}
                  value={comment}
                  style={confirmationStyles.input}
                />
              </View>
            )}
            {!!error && <Txt accessibilityRole="alert" size={14} color={colors.danger}>{error}</Txt>}
            <View style={confirmationStyles.actions}>
              <ShiftActionButton
                label={pending && kind === 'clock-in' ? 'Stempler ind…' : copy[kind].confirm}
                disabled={leave && !comment.trim()}
                busy={pending}
                onPress={submit}
              />
              <ShiftActionButton label="Annuller" secondary onPress={onDismiss} />
            </View>
          </View>
        )}
      </View>
    </RNHostView>
  );

  return needsScroll ? <ScrollView>{content}</ScrollView> : content;
}

const confirmationStyles = StyleSheet.create({
  hostContent: { width: '100%' },
  form: { width: '100%', gap: 16 },
  heading: { gap: 6 },
  field: { gap: 8 },
  input: {
    color: colors.ink, fontSize: 16, minHeight: 86, maxHeight: 150,
    textAlignVertical: 'top', padding: 12, backgroundColor: colors.paper,
    borderColor: colors.line, borderWidth: 1, borderRadius: 12,
  },
  actions: { width: '100%', gap: 4 },
});

function StampFeedback({ kind, result, onDismiss, onRetry }: {
  kind: StampKind;
  result: Result;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const reduceMotion = useReduceMotionPreference();
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  const badgeMotion = useAnimatedStyle(() => {
    const value = progress.get();
    return { opacity: 0.4 + value * 0.6, transform: [{ scale: 0.68 + value * 0.32 }] };
  });
  const color = result.ok ? colors.success : result.uncertain ? colors.warning : colors.danger;
  const title = result.ok
    ? (kind === 'clock-in' ? 'Stemplet ind' : 'Stemplet ud')
    : result.uncertain ? 'Status ikke bekræftet' : (kind === 'clock-in' ? 'Indstempling mislykkedes' : 'Udstempling mislykkedes');
  const message = result.ok ? 'Stemplingen er registreret i appen.' : result.error ?? 'Prøv igen.';

  useEffect(() => {
    progress.set(reduceMotion ? 1 : withTiming(1, badgeTiming));
  }, [progress, reduceMotion]);

  useEffect(() => {
    if (process.env.EXPO_OS === 'ios') AccessibilityInfo.announceForAccessibility(`${title}. ${message}`);
  }, [message, title]);

  return (
    <View style={feedbackStyles.content}>
      <Animated.View
        aria-hidden
        style={[feedbackStyles.badge, { backgroundColor: result.ok ? colors.successSoft : '#f9eeeb', borderColor: `${color}26` }, badgeMotion]}
      >
        <Icon name={result.ok ? 'check' : result.uncertain ? 'clock' : 'x'} size={28} color={color} />
      </Animated.View>
      <View accessibilityLiveRegion="polite" style={feedbackStyles.copy}>
        <Txt accessibilityRole="header" size={23} weight="700" style={feedbackStyles.title}>{title}</Txt>
        <Txt size={14} color={colors.muted} style={feedbackStyles.center}>{message}</Txt>
      </View>
      <View style={feedbackStyles.actions}>
        <ShiftActionButton label={result.ok ? 'Færdig' : result.uncertain ? 'Kontrollér igen' : 'Prøv igen'} onPress={result.ok ? onDismiss : onRetry} />
        {!result.ok && <ShiftActionButton label="Luk" secondary onPress={onDismiss} />}
      </View>
    </View>
  );
}

const feedbackStyles = StyleSheet.create({
  content: { width: '100%', alignItems: 'center', gap: 14, paddingTop: 4, paddingBottom: 4 },
  badge: { width: 62, height: 62, borderRadius: 31, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  copy: { gap: 4, alignItems: 'center', paddingHorizontal: 8 },
  title: { textAlign: 'center', letterSpacing: -0.35 },
  center: { textAlign: 'center' },
  actions: { width: '100%', gap: 4, paddingTop: 4 },
});
