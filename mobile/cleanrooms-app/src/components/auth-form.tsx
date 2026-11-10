import { KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import type { ReactNode, Ref } from 'react';

import { Txt } from '@/components/ui';
import { cardColors } from '@/constants/card-styles';
import { colors } from '@/constants/palette';

export function AuthForm({ children, centered = false, transparent = false }: { children: ReactNode; centered?: boolean; transparent?: boolean }) {
  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={[styles.screen, transparent && styles.transparent]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, centered && styles.centered]}
      >
        <View style={styles.form}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function CredentialField({ label, ...props }: TextInputProps & { label: string; ref?: Ref<TextInput> }) {
  return (
    <View style={styles.field}>
      <Txt size={14} weight="600">{label}</Txt>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        selectionColor={colors.accent}
        placeholderTextColor={colors.muted}
        {...props}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cardColors.canvas },
  transparent: { backgroundColor: 'transparent' },
  scroll: { flexGrow: 1, paddingHorizontal: 22, paddingVertical: 24 },
  centered: { justifyContent: 'center' },
  form: { width: '100%', maxWidth: 460, alignSelf: 'center', gap: 18 },
  field: { gap: 6 },
  input: {
    minHeight: 50, paddingHorizontal: 13, paddingVertical: 10, borderWidth: 1,
    borderColor: cardColors.border, borderRadius: 11, borderCurve: 'continuous',
    backgroundColor: colors.white, color: colors.ink, fontSize: 17,
  },
});
