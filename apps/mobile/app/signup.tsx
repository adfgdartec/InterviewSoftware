import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../src/supabase';
import { API_BASE_URL } from '../src/config';
import { theme, space } from '../src/theme';

/**
 * Signup, with the same age and region gate the web form applies.
 *
 * The gate is enforced server-side at provisioning too, so this screen cannot be the only
 * thing standing between an under-13 account and existence -- but refusing here means no
 * auth user is created at all, which is the same ordering the web action uses.
 *
 * `13_to_15` is admitted only where the region is EXPLICITLY non-EU: an unstated region
 * cannot be ruled out as the EU, so it fails closed.
 */

const AGE_BANDS = [
  { value: 'under_13', label: 'Under 13' },
  { value: '13_to_15', label: '13 to 15' },
  { value: '16_plus', label: '16 or older' },
] as const;

const REGIONS = [
  { value: 'eu', label: 'European Union' },
  { value: 'illinois', label: 'Illinois' },
  { value: 'us_other', label: 'Another US state' },
  { value: 'other', label: 'Elsewhere' },
] as const;

function permitted(ageBand: string, jurisdiction: string): boolean {
  if (ageBand === '16_plus') return true;
  if (ageBand === '13_to_15') {
    return jurisdiction === 'illinois' || jurisdiction === 'us_other' || jurisdiction === 'other';
  }
  return false;
}

function refusal(ageBand: string): string {
  if (ageBand === 'under_13') return 'You need to be at least 13 to use this. Nothing has been created.';
  return 'In the European Union you need to be 16 or older to use this. Nothing has been created.';
}

function Choice({ options, value, onChange }: {
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === o.value }}
          style={{
            borderWidth: 1, borderRadius: 999, paddingVertical: space.sm, paddingHorizontal: space.md,
            borderColor: value === o.value ? theme.plum700 : theme.ruleFirm,
            backgroundColor: value === o.value ? theme.plum100 : theme.raised,
          }}
        >
          <Text style={{ color: value === o.value ? theme.plum900 : theme.inkSoft, fontWeight: '600' }}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function SignUp() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [ageBand, setAgeBand] = useState('');
  const [region, setRegion] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(): Promise<void> {
    setError(null);
    if (password.length < 10) return setError('Use a password of at least 10 characters.');
    if (!accepted) return setError('You need to accept the terms and privacy notice to continue.');
    if (!permitted(ageBand, region)) return setError(refusal(ageBand));

    setPending(true);
    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: name === '' ? null : name,
          age_band: ageBand,
          jurisdiction: region,
        },
      },
    });
    setPending(false);
    if (authError !== null) return setError('Could not create that account. Try a different email.');
    setSent(true);
  }

  if (sent) {
    return (
      <View style={{ flex: 1, padding: space.lg, gap: space.md, justifyContent: 'center' }}>
        <Text style={{ fontSize: 26, fontWeight: '700', color: theme.plum900 }}>Check your email</Text>
        <Text style={{ color: theme.inkSoft, fontSize: 16 }}>
          We have sent a confirmation link. Your account is not active until you open it.
        </Text>
        <Pressable
          onPress={() => router.replace('/signin')}
          style={{ backgroundColor: theme.plum700, borderRadius: 8, padding: space.md, alignItems: 'center' }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>Back to sign in</Text>
        </Pressable>
      </View>
    );
  }

  const field = {
    borderWidth: 1, borderColor: theme.ruleFirm, borderRadius: 8,
    padding: space.md, fontSize: 16, backgroundColor: theme.raised, color: theme.ink,
  };
  const label = { fontSize: 11, letterSpacing: 1, color: theme.plum500 };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <Text style={{ fontSize: 28, fontWeight: '700', color: theme.plum900 }}>Create an account</Text>

      <View style={{ gap: space.xs }}>
        <Text style={label}>YOUR NAME</Text>
        <TextInput value={name} onChangeText={setName} style={field} />
        <Text style={{ fontSize: 12, color: theme.inkSoft }}>Optional. Shown only to you.</Text>
      </View>

      <View style={{ gap: space.xs }}>
        <Text style={label}>EMAIL</Text>
        <TextInput
          value={email} onChangeText={setEmail} autoCapitalize="none"
          keyboardType="email-address" autoComplete="email" style={field}
        />
      </View>

      <View style={{ gap: space.xs }}>
        <Text style={label}>PASSWORD</Text>
        <TextInput
          value={password} onChangeText={setPassword} secureTextEntry
          autoComplete="new-password" style={field}
        />
        <Text style={{ fontSize: 12, color: theme.inkSoft }}>At least 10 characters.</Text>
      </View>

      <View style={{ gap: space.sm }}>
        <Text style={label}>YOUR AGE</Text>
        <Choice options={AGE_BANDS} value={ageBand} onChange={setAgeBand} />
        <Text style={{ fontSize: 12, color: theme.inkSoft }}>
          Self-reported. We do not verify it. Accounts are limited to 13 and over, and 16 and
          over in the EU.
        </Text>
      </View>

      <View style={{ gap: space.sm }}>
        <Text style={label}>WHERE YOU ARE</Text>
        <Choice options={REGIONS} value={region} onChange={setRegion} />
        <Text style={{ fontSize: 12, color: theme.inkSoft }}>
          Sets which features are available. The camera framing check is disabled entirely in
          the EU and Illinois.
        </Text>
      </View>

      <Pressable
        onPress={() => setAccepted((a) => !a)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}
      >
        <View
          style={{
            width: 22, height: 22, borderRadius: 4, borderWidth: 1, marginTop: 2,
            borderColor: accepted ? theme.plum700 : theme.ruleFirm,
            backgroundColor: accepted ? theme.plum700 : theme.raised,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          {accepted ? <Text style={{ color: '#fff', fontWeight: '700' }}>✓</Text> : null}
        </View>
        <Text style={{ flex: 1, color: theme.ink }}>
          I accept the{' '}
          <Text
            style={{ color: theme.plum700, textDecorationLine: 'underline' }}
            onPress={() => void Linking.openURL(`${API_BASE_URL}/terms`)}
          >
            terms of service
          </Text>{' '}
          and the{' '}
          <Text
            style={{ color: theme.plum700, textDecorationLine: 'underline' }}
            onPress={() => void Linking.openURL(`${API_BASE_URL}/privacy`)}
          >
            privacy notice
          </Text>
          .
        </Text>
      </Pressable>

      {error !== null ? (
        <Text accessibilityRole="alert" style={{ color: theme.danger, fontWeight: '600' }}>{error}</Text>
      ) : null}

      <Pressable
        onPress={() => void submit()}
        disabled={pending || email === '' || password === '' || ageBand === '' || region === ''}
        style={{
          backgroundColor: theme.plum700, borderRadius: 8, padding: space.md, alignItems: 'center',
          opacity: pending || email === '' || password === '' || ageBand === '' || region === '' ? 0.5 : 1,
        }}
      >
        {pending ? <ActivityIndicator color="#fff" /> : (
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Create account</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
