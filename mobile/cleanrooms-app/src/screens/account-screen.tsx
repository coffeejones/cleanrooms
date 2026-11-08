import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, View } from 'react-native';
import { Column, Host, Switch } from '@expo/ui';

import { useMobileAuth } from '@/auth/mobile-auth';
import { maximumPasswordLength, minimumPasswordLength } from '@/auth/mobile-auth-api';
import { AuthForm, CredentialField } from '@/components/auth-form';
import { Avatar, Button, Row, Surface, Txt } from '@/components/ui';
import { cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { useEmployeePreferences, type EmployeePreferences } from '@/state/employee-data';

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
    <AuthForm>
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
  );
}

function NotificationPreferences({ disabled }: { disabled: boolean }) {
  const { state, employeeRequest } = useMobileAuth();
  const resource = useEmployeePreferences();
  const scope = state.mode === 'signedIn' ? `${state.session.employee.workspaceId}:${state.session.employee.personId}` : '';
  const [saved, setSaved] = useState<{ scope: string; value: EmployeePreferences }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const value = saved?.scope === scope && saved.value.version >= (resource.data?.version ?? -1) ? saved.value : resource.data;

  async function change(key: 'notifications' | 'chatNotifications', next: boolean) {
    if (!value || !scope || busy.current || disabled) return;
    busy.current = true; setSaving(true); setError('');
    try {
      const confirmed = await employeeRequest<EmployeePreferences>({ action: 'employeePreference', key, value: next, version: value.version });
      if (mounted.current) setSaved({ scope, value: confirmed });
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : 'Indstillingen kunne ikke gemmes. Prøv igen.');
        resource.refresh();
      }
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <Surface style={[cardStyles.listSurface, styles.card]}>
      <Txt size={17} weight="700" accessibilityRole="header">Notifikationer</Txt>
      {value ? <Host testID="settings-switches" matchContents={{ vertical: true }} style={{ width: '100%' }} colorScheme="light" seedColor={colors.accent}>
        <Column spacing={14} style={{ width: '100%' }}>
          <Switch label="Vagtændringer og anmodninger" value={value.notifications} disabled={disabled || saving}
            onValueChange={next => { void change('notifications', next); }} testID="account-preference-notifications" />
          <Switch label="Nye chatbeskeder" value={value.chatNotifications} disabled={disabled || saving}
            onValueChange={next => { void change('chatNotifications', next); }} testID="account-preference-chat" />
        </Column>
      </Host> : <Row gap={8}>
        {resource.loading && <ActivityIndicator size="small" color={colors.accent} />}
        <Txt size={13} color={colors.muted}>{resource.error ?? 'Henter indstillinger…'}</Txt>
      </Row>}
      {!!error && <Txt accessibilityRole="alert" size={13} color={colors.danger}>{error}</Txt>}
      {!!resource.error && <Button label="Prøv igen" compact variant="ghost" onPress={resource.refresh} disabled={saving || disabled} />}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { gap: 13 },
  profile: { flex: 1, gap: 3 },
});
