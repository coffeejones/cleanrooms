import { useIsFocused } from 'expo-router/react-navigation';
import { useLayoutEffect, useRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { useReduceMotionPreference } from './motion-preference';
import { PressFeedback } from './press-feedback';
import { Icon, Row } from './ui';

export function ChatSearchField({ value, onChangeText }: { value: string; onChangeText: (value: string) => void }) {
  const input = useRef<TextInput>(null);

  function clear() {
    onChangeText('');
    input.current?.focus();
  }

  return (
    <View style={[cardStyles.raisedFrame, styles.frame]}>
      <Row gap={10} style={[cardStyles.raisedSurface, styles.search]}>
        <Icon name="search" size={17} color={colors.muted} />
        <TextInput
          ref={input}
          accessibilityLabel="Søg efter chatrum"
          placeholder="Søg i samtaler"
          placeholderTextColor={colors.muted}
          value={value}
          onChangeText={onChangeText}
          autoCorrect={false}
          clearButtonMode="never"
          returnKeyType="search"
          style={styles.input}
        />
        <View style={styles.clearSlot}>
          {!!value.length && (
            <PressFeedback
              accessibilityRole="button"
              accessibilityLabel="Ryd søgning"
              haptic="selection"
              hitSlop={6}
              onPress={clear}
              style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
            >
              <Icon name="x" size={14} color={colors.muted} />
            </PressFeedback>
          )}
        </View>
      </Row>
    </View>
  );
}

export function useChatSearchMotion(query: string) {
  const focused = useIsFocused();
  const reduceMotion = useReduceMotionPreference();
  const previousQuery = useRef(query);
  const opacity = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  useLayoutEffect(() => {
    const changed = previousQuery.current !== query;
    previousQuery.current = query;
    if (!focused || reduceMotion) {
      cancelAnimation(opacity);
      opacity.set(1);
    } else if (changed) {
      opacity.set(0.88);
      opacity.set(withTiming(1, {
        duration: 140,
        easing: Easing.out(Easing.quad),
        reduceMotion: ReduceMotion.Never,
      }));
    }
    return () => cancelAnimation(opacity);
  }, [focused, opacity, query, reduceMotion]);

  return style;
}

const styles = StyleSheet.create({
  frame: { marginBottom: 16 },
  search: { paddingHorizontal: 13 },
  input: { flex: 1, minHeight: 46, paddingVertical: 10, color: colors.ink, fontSize: 16 },
  clearSlot: { width: 32, height: 44 },
  clear: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  pressed: { backgroundColor: cardColors.section },
});
