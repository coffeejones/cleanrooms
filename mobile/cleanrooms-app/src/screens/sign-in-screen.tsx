import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { Keyboard, StyleSheet, View, type TextInput } from 'react-native';

import { AuthForm, CredentialField } from '@/components/auth-form';
import { Button, Row, Surface, Txt } from '@/components/ui';
import { useMobileAuth } from '@/auth/mobile-auth';
import { authUnavailableMessage, canUseMobileAuth, maximumPasswordLength } from '@/auth/mobile-auth-api';
import { cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';

export default function SignInScreen() {
  const auth = useMobileAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const passwordField = useRef<TextInput>(null);

  async function submit() {
    if (busy || !canUseMobileAuth) return;
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Indtast din e-mailadresse.');
      return;
    }
    if (!password || [...password].length > maximumPasswordLength) {
      setError('Indtast din adgangskode.');
      return;
    }
    Keyboard.dismiss();
    setBusy(true);
    setError('');
    const result = await auth.signIn(address, password);
    if (!result.ok) {
      setPassword('');
      setError(result.error);
      setBusy(false);
    }
  }

  const notice = auth.state.mode === 'signedOut' ? auth.state.notice : undefined;
  const canRetry = auth.state.mode === 'signedOut' && auth.state.retry;

  return (
    <AuthForm centered>
      <View style={styles.intro}>
        <Row gap={9}>
          <Image source={require('../../assets/images/app-icon.png')} style={styles.logo} accessibilityElementsHidden />
          <Txt size={18} weight="700">CleanRooms</Txt>
        </Row>
        <Txt size={29} weight="700" accessibilityRole="header">Log ind</Txt>
        <Txt color={colors.muted}>Brug din e-mail og den adgangskode, du har fået af din administrator.</Txt>
      </View>

      <Surface style={[cardStyles.listSurface, styles.card]}>
        <CredentialField
          label="E-mail"
          value={email}
          editable={!busy && canUseMobileAuth}
          onChangeText={setEmail}
          autoComplete="username"
          keyboardType="email-address"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordField.current?.focus()}
          maxLength={320}
          testID="mobile-auth-email"
        />
        <CredentialField
          label="Adgangskode"
          ref={passwordField}
          value={password}
          editable={!busy && canUseMobileAuth}
          onChangeText={setPassword}
          autoComplete="current-password"
          secureTextEntry
          returnKeyType="go"
          onSubmitEditing={() => { void submit(); }}
          maxLength={maximumPasswordLength * 2}
          testID="mobile-auth-password"
        />
        {!!error && <Txt size={14} color={colors.danger} accessibilityRole="alert">{error}</Txt>}
        {!canUseMobileAuth && <Txt size={14} color={colors.muted}>{authUnavailableMessage}</Txt>}
        {!!notice && <Txt size={14} color={colors.muted} accessibilityLiveRegion="polite">{notice}</Txt>}
        <Button label={busy ? 'Logger ind…' : 'Log ind'} onPress={() => { void submit(); }} disabled={busy || !canUseMobileAuth} />
        {canRetry && <Button label="Genoptag session" onPress={() => { void auth.retrySession(); }} variant="secondary" disabled={busy} />}
      </Surface>

      <Button label="Prøv demoen" onPress={auth.openDemo} variant="ghost" disabled={busy} />
    </AuthForm>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 8 },
  logo: { width: 28, height: 28, borderRadius: 7 },
  card: { gap: 13 },
});
