import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, Row, Txt } from '@/components/ui';
import { colors } from '@/constants/palette';
import type { WorksiteInfo } from '@/domain/model';

export function WorksiteInformation({ information }: { information?: WorksiteInfo }) {
  const [open, setOpen] = useState(false);
  if (!information || !Object.values(information).some(Boolean)) return null;
  return <View style={{ gap: 12 }}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Praktisk information om arbejdsstedet"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen(value => !value)}
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.65 : 1 })}
    ><Row gap={8}>
      <Icon name="info" size={16} color={colors.muted} />
      <Txt size={13} weight="500" style={{ flex: 1 }}>Praktisk information</Txt>
      <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}><Icon name="chevron-down" size={11} color={colors.muted} /></View>
    </Row></Pressable>
    {open && <View style={{ gap: 16, paddingBottom: 4 }}>
      {!!(information.contactName || information.contactPhone) && <View style={{ gap: 3 }}>
        <Txt size={12} weight="500" color={colors.muted}>Kontaktperson</Txt>
        {!!information.contactName && <Txt size={14}>{information.contactName}</Txt>}
        {!!information.contactPhone && <Txt size={14}>{information.contactPhone}</Txt>}
      </View>}
      {!!information.parking && <View style={{ gap: 3 }}>
        <Txt size={12} weight="500" color={colors.muted}>Parkering</Txt>
        <Txt size={14} style={{ lineHeight: 21 }}>{information.parking}</Txt>
      </View>}
      {!!information.accessInstructions && <View style={{ gap: 3 }}>
        <Txt size={12} weight="500" color={colors.muted}>Adgangsvejledning</Txt>
        <Txt size={14} style={{ lineHeight: 21 }}>{information.accessInstructions}</Txt>
      </View>}
    </View>}
  </View>;
}
