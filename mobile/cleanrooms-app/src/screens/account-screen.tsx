import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, View } from 'react-native';
import { Column, Host, Picker, Row as NativeRow, Spacer, Switch, Text as NativeText } from '@expo/ui';

import { useMobileAuth } from '@/auth/mobile-auth';
import { maximumPasswordLength, minimumPasswordLength } from '@/auth/mobile-auth-api';
import { AuthForm, CredentialField } from '@/components/auth-form';
import { FlowScreen } from '@/components/flow-screen';
import { Avatar, Button, Row, Surface, Txt } from '@/components/ui';
import { cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { usePushNotifications } from '@/notifications/push-notifications';
import { useEmployeePreferences, type EmployeePreferences } from '@/state/employee-data';
import { confirmsEmployeePreference, reminderLeadMinutes, type EmployeePreferenceKey, type ReminderLeadMinutes } from '@/state/employee-preferences-wire';
import { invalidateEmployeeResources } from '@/state/published-schedule';
import { useScopedState } from '@/state/scoped-state';

export default function AccountScreen() {
  const auth = useMobileAuth();
  const [changing, setChanging] = useState(false);
  const [pending, setPending] = useState<'change' | 'signOut' | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeated, setRepeated] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (auth.state.mode !== 'signedIn') return null;
  const { employee, temporaryPassword } = auth.state.session;
  const initials = employee.name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0]).join('').toUpperCase();

  function closeChange() {
    setChanging(false);
    setCurrent('');
    setNext('');
    setRepeated('');
    setError('');
  }

  async function change() {
    if (pending) return;
    const length = [...next].length;
    if (!current) {
      setError('Indtast din nuværende adgangskode.');
      return;
    }
    if (length < minimumPasswordLength || length > maximumPasswordLength) {
      setError(`Vælg en adgangskode på mellem ${minimumPasswordLength} og ${maximumPasswordLength} tegn.`);
      return;
    }
    if (next !== repeated) {
      setError('De nye adgangskoder er ikke ens.');
      return;
    }
    Keyboard.dismiss();
    setPending('change');
    setError('');
    setNotice('');
    const result = await auth.changePassword(current, next);
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    closeChange();
    setNotice('Adgangskoden er ændret.');
  }

  async function signOut() {
    if (pending) return;
    setError('');
    setPending('signOut');
    const result = await auth.signOut();
    if (!result.ok) {
      setPending(null);
      setError(result.error);
    }
  }

  return (
    <FlowScreen>
      <AuthForm transparent>
        <Surface style={[cardStyles.listSurface, styles.card]}>
          <Row gap={13}>
            <Avatar initials={initials} size={45} />
            <View style={styles.profile}>
              <Txt size={21} weight="700" accessibilityRole="header">{employee.name}</Txt>
              <Txt size={14} color={colors.muted}>{employee.email}</Txt>
            </View>
          </Row>
        </Surface>

        <NotificationPreferences disabled={Boolean(pending)} />

        <Surface style={[cardStyles.listSurface, styles.card]}>
          <Txt size={17} weight="700" accessibilityRole="header">Adgangskode</Txt>
          {temporaryPassword && <Txt size={14} color={colors.muted}>Du bruger stadig startkoden. Du kan vælge din egen adgangskode her.</Txt>}
          {changing ? (
            <>
              <CredentialField label="Nuværende adgangskode" value={current} onChangeText={setCurrent} autoComplete="current-password" secureTextEntry editable={!pending} maxLength={maximumPasswordLength * 2} testID="mobile-auth-current" />
              <CredentialField label="Ny adgangskode" value={next} onChangeText={setNext} autoComplete="new-password" secureTextEntry editable={!pending} maxLength={maximumPasswordLength * 2} testID="mobile-auth-next" />
              <CredentialField label="Gentag ny adgangskode" value={repeated} onChangeText={setRepeated} autoComplete="new-password" secureTextEntry editable={!pending} maxLength={maximumPasswordLength * 2} returnKeyType="done" onSubmitEditing={() => { void change(); }} testID="mobile-auth-repeat" />
              <Txt size={13} color={colors.muted}>Brug mindst {minimumPasswordLength} tegn.</Txt>
              <Button label={pending === 'change' ? 'Gemmer…' : 'Gem adgangskode'} onPress={() => { void change(); }} disabled={Boolean(pending)} />
              <Button label="Annuller" onPress={closeChange} variant="ghost" disabled={Boolean(pending)} />
            </>
          ) : <Button label="Skift adgangskode" onPress={() => { setNotice(''); setChanging(true); }} variant="secondary" disabled={Boolean(pending)} />}
          {!!notice && <Txt size={14} color={colors.success} accessibilityLiveRegion="polite">{notice}</Txt>}
          {!!error && <Txt size={14} color={colors.danger} accessibilityRole="alert">{error}</Txt>}
        </Surface>

        <Button label={pending === 'signOut' ? 'Logger ud…' : 'Log ud'} onPress={() => { void signOut(); }} variant="ghost" disabled={Boolean(pending)} />
      </AuthForm>
    </FlowScreen>
  );
}

function NotificationPreferences({ disabled }: { disabled: boolean }) {
  const { state, sessionEpoch, employeeRequest } = useMobileAuth();
  const resource = useEmployeePreferences();
  const push = usePushNotifications();
  const scope = state.mode === 'signedIn' ? JSON.stringify([state.session.employee.workspaceId, state.session.employee.personId, sessionEpoch]) : '';
  const [saved, setSaved] = useState<{ scope: string; value: EmployeePreferences }>();
  const [saving, setSaving] = useScopedState(scope, false);
  const [testing, setTesting] = useScopedState(scope, false);
  const [testReceipt, setTestReceipt] = useState<{ scope: string; text: string; ok: boolean }>();
  const [error, setError] = useScopedState(scope, '');
  const busy = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  useLayoutEffect(() => { const version = ++generation.current; busy.current = false;return () => { generation.current = version + 1; }; }, [scope]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const value = saved?.scope === scope && saved.value.version >= (resource.data?.version ?? -1) ? saved.value : resource.data;

  async function testPush() {
    if (busy.current || disabled) return;
    const requestGeneration = generation.current;
    const current = () => mounted.current && generation.current === requestGeneration;
    busy.current = true;setTesting(true);setTestReceipt(undefined);
    try {
      await push.sendTest();
      if (current()) setTestReceipt({ scope, text: 'Testbesked bestilt. Den sendes til denne telefon.', ok: true });
    } catch (cause) {
      if (current()) setTestReceipt({ scope, text: cause instanceof Error ? cause.message : 'Testbeskeden kunne ikke bestilles.', ok: false });
    } finally {
      if (current()) { busy.current = false;setTesting(false); }
    }
  }

  async function change(key: EmployeePreferenceKey, next: boolean | ReminderLeadMinutes) {
    if (!value || !scope || busy.current || disabled || value[key] === next) return;
    const requestGeneration = generation.current;
    const current = () => mounted.current && generation.current === requestGeneration;
    busy.current = true; setSaving(true); setError('');
    try {
      if (next === true && !await push.enable()) return;
      if (!current()) return;
      const result = await employeeRequest({ action: 'employeePreference', key, value: next, version: value.version });
      if (!current()) return;
      const confirmed = confirmsEmployeePreference(result, key, next, value.version);
      setSaved({ scope, value: confirmed });invalidateEmployeeResources('preferences');push.refresh();
    } catch (cause) {
      if (current()) {
        setError(cause instanceof Error ? cause.message : 'Indstillingen kunne ikke gemmes. Prøv igen.');
        resource.refresh();
      }
    } finally {
      if (current()) { busy.current = false;setSaving(false); }
    }
  }

  return (
    <Surface style={[cardStyles.listSurface, styles.card]}>
      <Row gap={8}><Txt size={17} weight="700" accessibilityRole="header" style={{ flex: 1 }}>Notifikationer</Txt>
        {saving && <ActivityIndicator size="small" color={colors.accent} accessibilityLabel="Gemmer indstilling" />}
      </Row>
      {value ? <Host testID="settings-switches" matchContents={{ vertical: true }} style={{ width: '100%' }} colorScheme="light" seedColor={colors.accent}>
        <Column spacing={14} style={{ width: '100%' }}>
          <Switch label="Vagtændringer og anmodninger" value={value.notifications} disabled={disabled || saving || testing}
            onValueChange={next => { void change('notifications', next); }} testID="account-preference-notifications" />
          <Switch label="Nye chatbeskeder" value={value.chatNotifications} disabled={disabled || saving || testing}
            onValueChange={next => { void change('chatNotifications', next); }} testID="account-preference-chat" />
          <Switch label="Påmindelse før vagt" value={value.shiftReminders} disabled={disabled || saving || testing}
            onValueChange={next => { void change('shiftReminders', next); }} testID="account-preference-shift-reminders" />
          {value.shiftReminders && <NativeRow alignment="center" spacing={12} style={{ width: '100%' }}>
            <NativeText textStyle={{ fontSize: 14, color: colors.muted }}>Tid før vagt</NativeText>
            <Spacer flexible />
            <Picker selectedValue={value.reminderLeadMinutes} enabled={!disabled && !saving && !testing}
              onValueChange={next => { void change('reminderLeadMinutes', next); }} testID="account-preference-reminder-lead">
              {reminderLeadMinutes.map(minutes => <Picker.Item key={minutes} value={minutes} label={`${minutes} min.`} />)}
            </Picker>
          </NativeRow>}
          <Switch label="Husk udstempling" value={value.checkoutReminders} disabled={disabled || saving || testing}
            onValueChange={next => { void change('checkoutReminders', next); }} testID="account-preference-checkout-reminders" />
        </Column>
      </Host> : <Row gap={8}>
        {resource.loading && <ActivityIndicator size="small" color={colors.accent} />}
        <Txt size={13} color={colors.muted}>{resource.error ?? 'Henter indstillinger…'}</Txt>
      </Row>}
      {push.status === 'permission-required' && <Button label="Tillad beskeder på denne telefon" compact variant="ghost" disabled={saving || disabled} onPress={() => { void push.enable(); }} />}
      {push.status === 'permission-denied' && <Txt size={13} color={colors.muted}>Tillad beskeder under telefonens indstillinger for CleanRooms.</Txt>}
      {push.status === 'error' && <><Txt accessibilityRole="alert" size={13} color={colors.danger}>{push.message}</Txt><Button label="Prøv igen" compact variant="ghost" disabled={saving || disabled} onPress={push.refresh} /></>}
      {push.status === 'unavailable' && <Txt size={13} color={colors.muted}>{push.message}</Txt>}
      {push.status === 'ready' && <Button label={testing ? 'Bestiller testbesked…' : 'Send testbesked'} compact variant="ghost" disabled={testing || saving || disabled} onPress={() => { void testPush(); }} />}
      {testReceipt?.scope === scope && <Txt accessibilityLiveRegion="polite" size={13} color={testReceipt.ok ? colors.muted : colors.danger}>{testReceipt.text}</Txt>}
      {!!error && <Txt accessibilityRole="alert" size={13} color={colors.danger}>{error}</Txt>}
      {!!resource.error && <Button label="Prøv igen" compact variant="ghost" onPress={resource.refresh} disabled={saving || disabled} />}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { gap: 13 },
  profile: { flex: 1, gap: 3 },
});
