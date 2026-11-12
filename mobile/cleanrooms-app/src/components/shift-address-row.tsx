import { openURL } from 'expo-linking';
import { useRef } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { colors } from '@/constants/palette';
import { PressFeedback } from './press-feedback';
import { Icon, Txt } from './ui';

async function openAddress(address: string) {
  const query = encodeURIComponent(address);
  const ios = process.env.EXPO_OS === 'ios';
  const appUrl = ios
    ? `geo-navigation:///place?address=${query}`
    : process.env.EXPO_OS === 'android' ? `geo:0,0?q=${query}` : undefined;
  const mapUrl = ios
    ? `https://maps.apple.com/?q=${query}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;

  if (appUrl) {
    try {
      await openURL(appUrl);
      return;
    } catch {
      // A device without a handler for this scheme can still open the map link.
    }
  }
  await openURL(mapUrl);
}

export function ShiftAddressRow({ address }: { address?: string | null }) {
  const opening = useRef(false);
  const text = address?.trim();
  if (!text) return null;

  async function openMap(value: string) {
    if (opening.current) return;
    opening.current = true;
    try {
      await openAddress(value);
    } catch {
      Alert.alert('Kortet kunne ikke åbnes', 'Prøv at trykke på adressen igen.');
    } finally {
      opening.current = false;
    }
  }

  return (
    <PressFeedback
      accessibilityRole="link"
      accessibilityLabel={text}
      accessibilityHint="Åbner adressen på et kort"
      hitSlop={10}
      onPress={() => { void openMap(text); }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Icon name="map-pin" size={14} color={colors.muted} />
      <Txt size={13} color={colors.muted} style={styles.address} selectable={false}>{text}</Txt>
      <View style={styles.arrow}>
        <Icon name="arrow-up-right" size={12} color={colors.muted} />
      </View>
    </PressFeedback>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, borderRadius: 5 },
  pressed: { backgroundColor: colors.paper },
  address: { flex: 1, minWidth: 0 },
  arrow: { paddingTop: 2 },
});
