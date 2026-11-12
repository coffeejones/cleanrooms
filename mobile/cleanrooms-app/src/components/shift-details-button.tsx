import { router } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/constants/palette';
import { PressFeedback } from './press-feedback';

type ShiftDetailsButtonProps = Omit<ComponentProps<typeof PressFeedback>, 'children' | 'onPress' | 'ref' | 'style'> & {
  shiftId: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function ShiftDetailsButton({ shiftId, children, style, ...props }: ShiftDetailsButtonProps) {
  return (
    <PressFeedback
      {...props}
      style={({ pressed }) => [style, pressed && styles.pressed]}
      onPress={() => router.push({ pathname: '/shift/[id]', params: { id: shiftId } })}
    >
      {children}
    </PressFeedback>
  );
}

const styles = StyleSheet.create({
  pressed: { backgroundColor: colors.paper },
});
