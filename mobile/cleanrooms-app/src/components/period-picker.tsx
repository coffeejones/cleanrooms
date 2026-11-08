import { BottomSheet, RNHostView, ScrollView } from '@expo/ui';
import NativeDatePicker from '@expo/ui/community/datetime-picker';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ShiftActionButton } from '@/components/shift-confirmation';
import { Icon, IconButton, Row, Txt } from '@/components/ui';
import { colors } from '@/constants/palette';
import { copenhagenDate, dateLabel, instantForLocal, TIME_ZONE, validDate } from '@/domain/model';

type Props = {
  visible: boolean;
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
  onDismiss: () => void;
};
type DateField = 'from' | 'to';

const web = process.env.EXPO_OS === 'web';
const android = process.env.EXPO_OS === 'android';
const ios = process.env.EXPO_OS === 'ios';

function toPickerDate(value: string) {
  // Android's picker consumes the device's local calendar day, regardless of timeZoneName.
  return android ? new Date(value + 'T12:00:00') : new Date(instantForLocal(value, '12:00'));
}

function fromPickerDate(value: Date) {
  if (!android) return copenhagenDate(value.getTime());
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return [year, month, day].join('-');
}

export function PeriodPicker(props: Props) {
  const [active, setActive] = useState<DateField | null>(null);
  const calendarExpanded = ios && active !== null;
  const dismiss = () => {
    setActive(null);
    props.onDismiss();
  };

  return (
    <BottomSheet
      isPresented={props.visible}
      onDismiss={dismiss}
      snapPoints={calendarExpanded ? ['full'] : ['half', 'full']}
      containerColor={colors.surface}
      contentPadding={{ top: 16, bottom: 20, left: 20, right: 20 }}>
      <ScrollView showsIndicators={false}>
        <RNHostView matchContents={{ vertical: true }}>
          <PeriodForm
            key={`${props.visible}-${props.from}-${props.to}`}
            {...props}
            active={active}
            setActive={setActive}
            onDismiss={dismiss}
          />
        </RNHostView>
      </ScrollView>
    </BottomSheet>
  );
}

function PeriodForm({ from, to, onApply, onDismiss, active, setActive }: Props & {
  active: DateField | null;
  setActive: (field: DateField | null) => void;
}) {
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  const validDates = validDate(draftFrom) && validDate(draftTo);
  const reversed = validDates && draftFrom > draftTo;
  const tooLong = validDates && Date.parse(draftTo) - Date.parse(draftFrom) > 730 * 86_400_000;
  const valid = validDates && !reversed && !tooLong;

  return (
    <View style={styles.form}>
      <Row gap={8}>
        <Txt accessibilityRole="header" size={20} weight="700" style={styles.title}>Vælg periode</Txt>
        <IconButton name="x" label="Luk valg af periode" onPress={onDismiss} />
      </Row>

      <View style={styles.fields}>
        {(['from', 'to'] as const).map((field, index) => {
          const value = field === 'from' ? draftFrom : draftTo;
          const update = field === 'from' ? setDraftFrom : setDraftTo;
          const label = field === 'from' ? 'Fra' : 'Til';
          const fieldStyle = [styles.field, index > 0 && styles.divider];

          if (web) {
            return (
              <View key={field} style={fieldStyle}>
                <Txt size={13} weight="600" color={colors.muted} style={styles.fieldLabel}>{label}</Txt>
                <TextInput
                  accessibilityLabel={label}
                  value={value}
                  onChangeText={update}
                  placeholder="ÅÅÅÅ-MM-DD"
                  placeholderTextColor={colors.muted}
                  autoCorrect={false}
                  autoCapitalize="none"
                  maxLength={10}
                  style={styles.input}
                />
              </View>
            );
          }

          const date = dateLabel(value, { day: 'numeric', month: 'long', year: 'numeric' });
          const selected = active === field;
          return (
            <Pressable
              key={field}
              accessibilityRole="button"
              accessibilityLabel={`${label}, ${date}`}
              accessibilityState={{ expanded: selected }}
              onPress={() => setActive(selected ? null : field)}
              style={({ pressed }) => [fieldStyle, (pressed || selected) && styles.fieldActive]}>
              <Txt size={13} weight="600" color={colors.muted} style={styles.fieldLabel}>{label}</Txt>
              <Txt size={15} weight="600" style={styles.fieldValue}>{date}</Txt>
              <Icon name="calendar" size={17} color={selected ? colors.accent : colors.muted} />
            </Pressable>
          );
        })}
      </View>

      {web && <Txt size={12} color={colors.muted}>Brug formatet ÅÅÅÅ-MM-DD.</Txt>}

      {active && !web && (
        <NativeDatePicker
          key={active}
          value={toPickerDate(active === 'from' ? draftFrom : draftTo)}
          onValueChange={(_event, selectedDate) => {
            (active === 'from' ? setDraftFrom : setDraftTo)(fromPickerDate(selectedDate));
            setActive(null);
          }}
          onDismiss={() => setActive(null)}
          mode="date"
          presentation={android ? 'dialog' : 'inline'}
          display={android ? 'default' : 'inline'}
          locale="da_DK"
          timeZoneName={TIME_ZONE}
          accentColor={colors.accent}
        />
      )}

      {!valid && (
        <Txt accessibilityRole="alert" size={14} color={colors.danger}>
          {!validDates ? 'Skriv to gyldige datoer.' : reversed ? 'Slutdatoen skal ligge på eller efter startdatoen.' : 'Vælg en periode på højst to år.'}
        </Txt>
      )}
      <ShiftActionButton
        label="Vis periode"
        disabled={!valid}
        onPress={() => {
          onApply(draftFrom, draftTo);
          onDismiss();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { width: '100%', gap: 16, paddingBottom: 4 },
  title: { flex: 1, minWidth: 0, letterSpacing: -0.3 },
  fields: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, borderCurve: 'continuous', overflow: 'hidden' },
  field: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  fieldActive: { backgroundColor: colors.accentSoft },
  fieldLabel: { minWidth: 34 },
  fieldValue: { flex: 1, minWidth: 0 },
  input: { flex: 1, minWidth: 0, paddingVertical: 4, color: colors.ink, fontSize: 16, fontVariant: ['tabular-nums'] },
});
