import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../src/supabase.js';
import { theme, space } from '../src/theme.js';

/**
 * Sign-in. Password only: the native app has no browser to complete an OAuth redirect in
 * without extra plumbing, and Google sign-in is a follow-on rather than a blocker.
 *
 * The same deliberate vagueness as the web form on a failed attempt -- "that email and
 * password do not match an account" rather than "no account with that email", which would
 * turn this screen into an account-existence oracle.
 */
export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (authError !== null) {
      setError('That email and password do not match an account.');
      return;
    }
    router.replace('/');
  }

  return (
    <View style={{ flex: 1, padding: space.lg, gap: space.md }}>
      <Text style={{ fontSize: 28, fontWeight: '700', color: theme.plum900 }}>Sign in</Text>

      <View style={{ gap: space.xs }}>
        <Text style={{ fontSize: 11, letterSpacing: 1, color: theme.plum500 }}>EMAIL</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          style={{
            borderWidth: 1, borderColor: theme.ruleFirm, borderRadius: 8,
            padding: space.md, fontSize: 16, backgroundColor: theme.raised, color: theme.ink,
          }}
        />
      </View>

      <View style={{ gap: space.xs }}>
        <Text style={{ fontSize: 11, letterSpacing: 1, color: theme.plum500 }}>PASSWORD</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          style={{
            borderWidth: 1, borderColor: theme.ruleFirm, borderRadius: 8,
            padding: space.md, fontSize: 16, backgroundColor: theme.raised, color: theme.ink,
          }}
        />
      </View>

      {error !== null ? (
        <Text accessibilityRole="alert" style={{ color: theme.danger, fontWeight: '600' }}>
          {error}
        </Text>
      ) : null}

      <Pressable
        onPress={() => void submit()}
        disabled={pending || email === '' || password === ''}
        style={{
          backgroundColor: theme.plum700, borderRadius: 8, padding: space.md,
          alignItems: 'center', opacity: pending || email === '' || password === '' ? 0.5 : 1,
        }}
      >
        {pending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Sign in</Text>
        )}
      </Pressable>
    </View>
  );
}
