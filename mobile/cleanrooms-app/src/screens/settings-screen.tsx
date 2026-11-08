import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Column, Host, Switch } from '@expo/ui';

import { useMobileAuth } from '@/auth/mobile-auth';
import { Avatar, Button, Row, Surface, Txt } from '@/components/ui';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors as c } from '@/constants/palette';
import { useAppData } from '@/state/app-store';

export default function SettingsScreen() {
  const { leaveDemo } = useMobileAuth();
  const { state, self, actions, storageError } = useAppData();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <View style={cardStyles.raisedFrame}>
        <Surface style={[cardStyles.raisedSurface, styles.profile]}>
          <Row gap={12}>
            <Avatar initials={self.initials} size={44} />
            <View style={styles.profileName}>
              <Txt size={19} weight="700" accessibilityRole="header">{self.name}</Txt>
              <Txt size={13} color={c.muted}>{self.role} · CleanRooms</Txt>
            </View>
          </Row>
          <View style={[cardStyles.divider, styles.profileDetails]}>
            <SettingLine label="Adgang" value="Demo" />
            <SettingLine label="Tidszone" value="Europe/Copenhagen" />
          </View>
        </Surface>
      </View>
      <View style={cardStyles.listSurface}>
        <View style={styles.sectionHeader}>
          <Txt weight="700" accessibilityRole="header">Notifikationer</Txt>
        </View>
        <View style={[cardStyles.divider, styles.switches]}>
          <Host testID="settings-switches" matchContents={{ vertical: true }} style={{ width: '100%' }} colorScheme="light" seedColor={c.accent}>
            <Column spacing={12} style={{ width: '100%' }}>
              <Switch label="Vagtændringer og anmodninger" value={state.preferences.notifications} onValueChange={(value) => actions.setPreference('notifications', value)} testID="preference-notifications" />
              <Switch label="Nye chatbeskeder" value={state.preferences.chatNotifications} onValueChange={(value) => actions.setPreference('chatNotifications', value)} testID="preference-chat-notifications" />
            </Column>
          </Host>
        </View>
      </View>
      <View style={cardStyles.listSurface}>
        <View style={styles.sectionHeader}>
          <Txt weight="700" accessibilityRole="header">App</Txt>
        </View>
        <View style={[cardStyles.divider, styles.appDetails]}>
          <SettingLine label="Version" value="1.0" />
          <Button label="Tilbage til login" onPress={leaveDemo} variant="ghost" />
          {!!storageError && <Txt accessibilityRole="alert" size={13} color={c.danger}>{storageError}</Txt>}
          {confirmReset ? (
            <View style={{ gap: 10 }}>
              <Txt weight="600">Genskab startdata?</Txt>
              <Txt size={13} color={c.muted}>Vagter og øvrige demodata nulstilles.</Txt>
              <Button label="Genskab startdata" variant="danger" onPress={() => { actions.resetDemo(); setConfirmReset(false); setResetMessage('Startdata er genskabt.'); }} />
              <Button label="Annuller" variant="ghost" onPress={() => setConfirmReset(false)} />
            </View>
          ) : (
            <Button label="Genskab startdata" variant="secondary" onPress={() => { setConfirmReset(true); setResetMessage(''); }} />
          )}
          {!!resetMessage && <Txt accessibilityLiveRegion="polite" size={13} color={c.success}>{resetMessage}</Txt>}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cardColors.canvas },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28, gap: 14 },
  profile: { gap: 14, padding: 14 },
  profileName: { flex: 1, minWidth: 0, gap: 2 },
  profileDetails: { paddingTop: 12, gap: 8 },
  sectionHeader: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: cardColors.section, borderTopLeftRadius: 15, borderTopRightRadius: 15 },
  switches: { paddingHorizontal: 14, paddingVertical: 12 },
  appDetails: { paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
});

function SettingLine({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }} gap={6}>
      <Txt size={13} color={c.muted}>{label}</Txt>
      <Txt size={13}>{value}</Txt>
    </Row>
  );
}
