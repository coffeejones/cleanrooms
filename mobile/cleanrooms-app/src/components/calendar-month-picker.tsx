import { BottomSheet, RNHostView, ScrollView } from '@expo/ui';
import { Pressable, StyleSheet, View } from 'react-native';
import { PeriodArrows } from '@/components/period-arrows';
import { IconButton, Row, Txt } from '@/components/ui';
import { colors } from '@/constants/palette';

const monthNames = [
  'Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'December',
];
const monthsPerRow = 3;

export function CalendarMonthPicker({ year, selectedMonth, visible, onYearChange, onSelect, onDismiss }: {
  year: number;
  selectedMonth: string;
  visible: boolean;
  onYearChange: (offset: -1 | 1) => void;
  onSelect: (month: string) => void;
  onDismiss: () => void;
}) {
  return (
    <BottomSheet
      isPresented={visible}
      onDismiss={onDismiss}
      snapPoints={['half', 'full']}
      containerColor={colors.surface}
      contentPadding={{ top: 12, bottom: 20, left: 20, right: 20 }}
    >
      <ScrollView showsIndicators={false}>
        <RNHostView matchContents={{ vertical: true }}>
          <View style={styles.form}>
            <Row gap={8}>
              <Txt accessibilityRole="header" size={20} weight="700" style={styles.heading}>Vælg måned</Txt>
              <IconButton name="x" label="Luk valg af måned" onPress={onDismiss} />
            </Row>
            <Row gap={12} style={styles.yearBar}>
              <Txt size={19} weight="700" accessibilityLiveRegion="polite">{year}</Txt>
              <PeriodArrows
                previousLabel="Forrige år"
                nextLabel="Næste år"
                onPrevious={() => onYearChange(-1)}
                onNext={() => onYearChange(1)}
              />
            </Row>
            <View style={styles.grid}>
              {Array.from({ length: monthNames.length / monthsPerRow }, (_, row) => {
                const firstMonth = row * monthsPerRow;
                return (
                  <Row key={row} gap={8} style={styles.monthRow}>
                    {monthNames.slice(firstMonth, firstMonth + monthsPerRow).map((name, column) => {
                      const monthNumber = String(firstMonth + column + 1).padStart(2, '0');
                      const month = `${String(year).padStart(4, '0')}-${monthNumber}`;
                      const selected = month === selectedMonth;
                      return (
                        <Pressable
                          key={name}
                          accessibilityRole="button"
                          accessibilityLabel={`${name} ${year}`}
                          accessibilityState={{ selected }}
                          onPress={() => onSelect(`${month}-01`)}
                          style={({ pressed }) => [styles.month, selected && styles.selected, pressed && styles.pressed]}
                        >
                          <Txt
                            size={14}
                            weight={selected ? '700' : '500'}
                            color={selected ? colors.accent : colors.ink}
                            selectable={false}
                            style={styles.monthLabel}
                          >
                            {name}
                          </Txt>
                        </Pressable>
                      );
                    })}
                  </Row>
                );
              })}
            </View>
          </View>
        </RNHostView>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  form: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: 10, paddingBottom: 4 },
  heading: { flex: 1, minWidth: 0, letterSpacing: -0.3 },
  yearBar: { justifyContent: 'space-between' },
  grid: { gap: 8 },
  monthRow: { alignItems: 'stretch' },
  month: {
    flex: 1, minWidth: 0, minHeight: 46, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 5, paddingVertical: 8, backgroundColor: colors.paper, borderRadius: 10,
    borderCurve: 'continuous', borderWidth: 1, borderColor: 'transparent',
  },
  selected: { backgroundColor: colors.accentSoft, borderColor: '#a5b6af' },
  pressed: { opacity: 0.7 },
  monthLabel: { textAlign: 'center' },
});
