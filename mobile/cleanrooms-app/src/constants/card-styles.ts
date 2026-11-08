import { StyleSheet } from 'react-native';
import { colors } from './palette';

export const cardColors = {
  canvas: colors.canvas,
  border: colors.line,
  section: '#f8faf9',
};

export const cardStyles = StyleSheet.create({
  raisedFrame: {
    padding: 0,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: cardColors.border,
    boxShadow: '0 1px 2px rgba(0, 30, 43, 0.03), 0 5px 16px rgba(0, 30, 43, 0.04)',
  },
  raisedSurface: {
    backgroundColor: colors.white,
    borderRadius: 13,
    borderCurve: 'continuous',
  },
  listSurface: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: cardColors.border,
    borderRadius: 14,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
});
