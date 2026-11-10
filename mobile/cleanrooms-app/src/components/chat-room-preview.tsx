import { Text, type StyleProp, type TextStyle } from 'react-native';
import { colors } from '@/constants/palette';

export function ChatRoomPreview({ draft, text, style }: { draft?: string; text: string; style: StyleProp<TextStyle> }) {
  return (
    <Text numberOfLines={2} style={style}>
      {draft ? <><Text style={{ color: colors.accent, fontWeight: '600' }}>Kladde</Text>{` · ${draft}`}</> : text}
    </Text>
  );
}
