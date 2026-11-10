import { BottomSheet, RNHostView } from '@expo/ui';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, IconButton, Row, Txt } from '@/components/ui';
import { cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { shiftTimeLabel, dateLabel, type Shift } from '@/domain/model';

export function ShiftTimeChange({ shift }: { shift: Shift }) {
  const [visible, setVisible] = useState(false);
  const previous = shift.previousTime;
  if (!previous) return null;

  const date = dateLabel(shift.date, { weekday: 'long', month: 'long' });
  const dismiss = () => setVisible(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Vagttid ændret, ${date}`}
        accessibilityHint="Viser den tidligere og den nye tid"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Icon name="calendar" size={17} color={colors.danger} />
      </Pressable>
      <BottomSheet
        isPresented={visible}
        onDismiss={dismiss}
        containerColor={colors.surface}
        contentPadding={{ top: 16, bottom: 24, left: 20, right: 20 }}
      >
        <RNHostView matchContents={{ vertical: true }}>
          <View style={styles.sheet}>
            <Row gap={10}>
              <View style={styles.heading}>
                <Txt size={22} weight="700" accessibilityRole="header">Vagttid ændret</Txt>
                <Txt size={13} color={colors.muted}>{date}</Txt>
              </View>
              <IconButton name="x" label="Luk vagtændring" onPress={dismiss} />
            </Row>
            <View style={styles.times}>
              <View style={styles.time}>
                <Txt size={12} weight="600" color={colors.muted}>Tidligere tid</Txt>
                <Txt size={18} color={colors.muted} style={styles.previous}>{shiftTimeLabel(previous)}</Txt>
              </View>
              <View style={[styles.time, cardStyles.divider]}>
                <Txt size={12} weight="600" color={colors.accent}>Ny tid</Txt>
                <Txt size={22} weight="700">{shiftTimeLabel(shift)}</Txt>
              </View>
            </View>
          </View>
        </RNHostView>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  pressed: { backgroundColor: colors.paper },
  sheet: { width: '100%', gap: 16 },
  heading: { flex: 1, minWidth: 0, gap: 2 },
  times: { backgroundColor: colors.paper, borderRadius: 14, borderCurve: 'continuous', overflow: 'hidden' },
  time: { paddingHorizontal: 14, paddingVertical: 10, gap: 3 },
  previous: { textDecorationLine: 'line-through' },
});
