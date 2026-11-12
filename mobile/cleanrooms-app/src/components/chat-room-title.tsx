import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { colors } from '@/constants/palette';

export function chatRoomSearchPattern(query: string) {
  if (!query) return undefined;
  const literal = query.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
  return new RegExp('(' + literal + ')', 'iu');
}

export function ChatRoomTitle({ name, pattern, style }: {
  name: string;
  pattern?: RegExp;
  style: StyleProp<TextStyle>;
}) {
  const parts = pattern ? name.split(pattern) : [name];
  return (
    <Text numberOfLines={1} style={style}>
      {parts.map((part, index) => index % 2 === 0
        ? part
        : <Text key={index} style={styles.match}>{part}</Text>)}
    </Text>
  );
}

const styles = StyleSheet.create({
  match: { color: colors.accent, backgroundColor: colors.accentSoft },
});
