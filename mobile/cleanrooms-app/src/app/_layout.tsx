import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { AppProvider, useAppData } from '@/state/app-store';
import { MobileAuthProvider, useMobileAuth } from '@/auth/mobile-auth';
import { cardColors } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { MotionPreference, useReduceMotionPreference } from '@/components/motion-preference';
import { Txt } from '@/components/ui';
import '@/global.css';

export const unstable_settings = { initialRouteName: 'sign-in' };
function AppContent() {
  const { ready, storageError } = useAppData();
  const { state } = useMobileAuth();
  const reduceMotion = useReduceMotionPreference();
  const isDemo = state.mode === 'demo';
  if (state.mode === 'loading' || (isDemo && !ready)) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.white }}><Txt weight="600" size={22}>CleanRooms</Txt><Txt color={colors.muted}>{isDemo ? 'Åbner demoen…' : 'Åbner CleanRooms…'}</Txt></View>;
  return <View style={{ flex: 1, backgroundColor: colors.white }}>
    {isDemo && storageError && <View accessibilityRole="alert" style={{ backgroundColor: '#fff0e5', padding: 10 }}><Txt size={12}>{storageError}</Txt></View>}
    <Stack screenOptions={{ headerStyle: { backgroundColor: cardColors.canvas }, headerTintColor: colors.ink, headerTitleStyle: { fontSize: 17, fontWeight: '600' }, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: cardColors.canvas } }}>
      <Stack.Protected guard={state.mode === 'signedOut'}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={isDemo || state.mode === 'signedIn'}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: 'Indstillinger' }} />
        <Stack.Screen name="chat/[id]" options={{ title: 'Samtale', headerStyle: { backgroundColor: colors.white } }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifikationer' }} />
        <Stack.Screen name="shift/[id]" options={{
          title: 'Din vagt',
          animation: reduceMotion ? 'none' : process.env.EXPO_OS === 'ios' ? 'simple_push' : 'fade',
          animationDuration: 230,
        }} />
      </Stack.Protected>
      <Stack.Protected guard={state.mode === 'signedIn'}>
        <Stack.Screen name="account" options={{ title: 'Indstillinger' }} />
      </Stack.Protected>
    </Stack>
  </View>;
}
export default function RootLayout() {
  return <ThemeProvider value={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: colors.ink, background: colors.white, card: colors.white, text: colors.ink, border: colors.line } }}><MobileAuthProvider><AppProvider><StatusBar style="dark" /><MotionPreference><AppContent /></MotionPreference></AppProvider></MobileAuthProvider></ThemeProvider>;
}
