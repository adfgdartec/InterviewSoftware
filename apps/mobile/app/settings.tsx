import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { deleteAccount, loadProfile, saveProfile, type UserProfile } from '../src/api';
import { supabase } from '../src/supabase';
import { API_BASE_URL } from '../src/config';
import { theme, space } from '../src/theme';

/**
 * Settings, and the place deletion lives.
 *
 * The video toggle is DISABLED rather than hidden when the account is not eligible, with the
 * reason shown -- the same choice the web makes. A control that vanishes leaves someone
 * wondering whether the feature exists; a disabled one with an explanation tells them why.
 *
 * `videoEligible` is computed server-side and returned by the API. This screen renders that
 * answer; it does not re-derive it, because a client that decided its own eligibility would
 * be the thing the server-side gate exists to prevent.
 */

const REGIONS = [
  { value: 'eu', label: 'European Union' },
  { value: 'illinois', label: 'Illinois' },
  { value: 'us_other', label: 'Another US state' },
  { value: 'other', label: 'Elsewhere' },
] as const;

const AGE_BANDS = [
  { value: 'under_13', label: 'Under 13' },
  { value: '13_to_15', label: '13 to 15' },
  { value: '16_plus', label: '16 or older' },
] as const;

export default function Settings() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const p = await loadProfile();
      setProfile(p);
      setName(p.displayName ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your settings.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function patch(change: Partial<UserProfile>): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // The response is the authoritative post-update state, not an echo of what was sent --
      // so a change that clears the video opt-in shows up here immediately.
      setProfile(await saveProfile(change));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(): void {
    Alert.alert(
      'Delete your account?',
      'This purges your sessions, answers and scores immediately. It cannot be undone.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await deleteAccount();
                await supabase.auth.signOut();
                router.replace('/');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not delete your account.');
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  if (profile === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {error === null ? <ActivityIndicator color={theme.plum700} /> : (
          <Text accessibilityRole="alert" style={{ color: theme.danger, padding: space.lg, textAlign: 'center' }}>
            {error}
          </Text>
        )}
      </View>
    );
  }

  const label = { fontSize: 11, letterSpacing: 1, color: theme.plum500 };
  const chip = (selected: boolean) => ({
    borderWidth: 1, borderRadius: 999, paddingVertical: space.sm, paddingHorizontal: space.md,
    borderColor: selected ? theme.plum700 : theme.ruleFirm,
    backgroundColor: selected ? theme.plum100 : theme.raised,
  });

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <View style={{ gap: space.sm }}>
        <Text style={label}>YOUR NAME</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          onBlur={() => void patch({ displayName: name })}
          style={{
            borderWidth: 1, borderColor: theme.ruleFirm, borderRadius: 8,
            padding: space.md, fontSize: 16, backgroundColor: theme.raised, color: theme.ink,
          }}
        />
      </View>

      <View style={{ gap: space.sm }}>
        <Text style={label}>WHERE YOU ARE</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {REGIONS.map((r) => (
            <Pressable key={r.value} onPress={() => void patch({ jurisdiction: r.value })} disabled={busy}
              style={chip(profile.jurisdiction === r.value)}>
              <Text style={{ color: profile.jurisdiction === r.value ? theme.plum900 : theme.inkSoft, fontWeight: '600' }}>
                {r.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <Text style={label}>YOUR AGE</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {AGE_BANDS.map((a) => (
            <Pressable key={a.value} onPress={() => void patch({ ageBand: a.value })} disabled={busy}
              style={chip(profile.ageBand === a.value)}>
              <Text style={{ color: profile.ageBand === a.value ? theme.plum900 : theme.inkSoft, fontWeight: '600' }}>
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ fontSize: 12, color: theme.inkSoft }}>Self-reported. We do not verify it.</Text>
      </View>

      <View style={{ gap: space.sm }}>
        <Text style={label}>CAMERA FRAMING CHECK</Text>
        <Pressable
          onPress={() => void patch({ videoOptIn: !profile.videoOptIn })}
          disabled={busy || (!profile.videoEligible && !profile.videoOptIn)}
          style={{
            flexDirection: 'row', gap: space.sm, alignItems: 'center',
            opacity: !profile.videoEligible && !profile.videoOptIn ? 0.5 : 1,
          }}
        >
          <View
            style={{
              width: 22, height: 22, borderRadius: 4, borderWidth: 1,
              borderColor: profile.videoOptIn ? theme.plum700 : theme.ruleFirm,
              backgroundColor: profile.videoOptIn ? theme.plum700 : theme.raised,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            {profile.videoOptIn ? <Text style={{ color: '#fff', fontWeight: '700' }}>✓</Text> : null}
          </View>
          <Text style={{ color: theme.ink, flex: 1 }}>Analyse my camera framing during a round</Text>
        </Pressable>
        <Text style={{ fontSize: 12, color: theme.inkSoft }}>
          {profile.videoEligible
            ? 'Runs entirely on your device. No image or video is ever uploaded.'
            : 'Available once your region and age are set to an eligible value above. It is disabled entirely in the EU and Illinois.'}
        </Text>
      </View>

      {saved ? <Text style={{ color: theme.success, fontWeight: '600' }}>Saved.</Text> : null}
      {error !== null ? (
        <Text accessibilityRole="alert" style={{ color: theme.danger, fontWeight: '600' }}>{error}</Text>
      ) : null}

      <View style={{ gap: space.sm, borderTopWidth: 1, borderTopColor: theme.rule, paddingTop: space.lg }}>
        <Text style={label}>YOUR DATA</Text>
        <Pressable onPress={() => void Linking.openURL(`${API_BASE_URL}/privacy`)}>
          <Text style={{ color: theme.plum700, textDecorationLine: 'underline' }}>
            What is collected, and how long it is kept
          </Text>
        </Pressable>
        <Pressable
          onPress={confirmDelete}
          disabled={busy}
          style={{
            borderWidth: 1, borderColor: theme.danger, borderRadius: 8,
            padding: space.md, alignItems: 'center', marginTop: space.sm, opacity: busy ? 0.5 : 1,
          }}
        >
          <Text style={{ color: theme.danger, fontWeight: '700' }}>Delete my account</Text>
        </Pressable>
        <Text style={{ fontSize: 12, color: theme.inkSoft }}>
          Immediate and irreversible. Purges your sessions, answers and scores — not just your
          login.
        </Text>
      </View>

      <Pressable
        onPress={() => void supabase.auth.signOut().then(() => router.replace('/'))}
        style={{ padding: space.md, alignItems: 'center' }}
      >
        <Text style={{ color: theme.inkSoft, fontWeight: '600' }}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}
