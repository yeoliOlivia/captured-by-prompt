import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LibraryProvider } from '../src/library';
import { colors } from '../src/theme';

export default function Layout() {
  return <SafeAreaProvider><LibraryProvider><StatusBar style="dark" />
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.ink, headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="selection" options={{ title: 'Selected photos' }} />
      <Stack.Screen name="context" options={{ title: 'My context' }} />
      <Stack.Screen name="settings" options={{ title: 'Your workspace', presentation: 'modal' }} />
      <Stack.Screen name="photo/[id]" options={{ title: 'A closer look' }} />
    </Stack>
  </LibraryProvider></SafeAreaProvider>;
}
