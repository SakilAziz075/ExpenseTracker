import { Stack } from 'expo-router';
import AppLockGate from '../components/AppLockGate';

export default function RootLayout() {
  return (
    <AppLockGate>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="dashboard" />
        <Stack.Screen name="explore" />
      </Stack>
    </AppLockGate>
  );
}
