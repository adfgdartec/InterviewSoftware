import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text, View } from 'react-native';
import { BRAND } from '@loopcraft/core/catalog';
import { theme, space } from '../src/theme';

/**
 * Root layout. The Article 50 disclosure sits here, above every screen, for the same reason
 * it sits under the web header: it has to be prominent on every surface, not tucked into a
 * settings page or shown once at launch.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.raised },
          headerTintColor: theme.plum900,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: theme.paper },
        }}
      >
        <Stack.Screen name="index" options={{ title: BRAND.name }} />
        <Stack.Screen name="signin" options={{ title: 'Sign in' }} />
        <Stack.Screen name="signup" options={{ title: 'Create an account' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="session/[id]" options={{ title: 'Interview' }} />
      </Stack>
      <View style={{ backgroundColor: theme.plum900, paddingVertical: space.xs }}>
        <Text
          style={{
            color: '#fff',
            textAlign: 'center',
            fontSize: 11,
            letterSpacing: 1,
            fontVariant: ['tabular-nums'],
          }}
        >
          {BRAND.aiDisclosure.toUpperCase()}
        </Text>
      </View>
    </SafeAreaProvider>
  );
}
