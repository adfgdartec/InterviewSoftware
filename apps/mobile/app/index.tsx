import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LOOP_TEMPLATES, trackById } from '@loopcraft/core/catalog';
import { supabase } from '../src/supabase.js';
import { startLoop } from '../src/api.js';
import { theme, space } from '../src/theme.js';

/**
 * The catalogue. The templates come from @loopcraft/core, the SAME module the web app reads,
 * so the two clients can never disagree about what a loop contains -- which is the point of
 * the native app being a thin client rather than a reimplementation.
 */
export default function Catalogue() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSignedIn(data.session !== null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(session !== null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (signedIn === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator color={theme.plum700} />
      </View>
    );
  }

  if (!signedIn) {
    return (
      <View style={{ flex: 1, padding: space.lg, gap: space.md, justifyContent: 'center' }}>
        <Text style={{ fontSize: 26, fontWeight: '700', color: theme.plum900 }}>
          Rehearse an interview
        </Text>
        <Text style={{ color: theme.inkSoft, fontSize: 16 }}>
          Loops are graded against published, anchored rubrics.
        </Text>
        <Pressable
          onPress={() => router.push('/signin')}
          style={{ backgroundColor: theme.plum700, borderRadius: 8, padding: space.md, alignItems: 'center' }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  async function start(templateId: string, levelBand: string): Promise<void> {
    setStarting(templateId);
    setError(null);
    try {
      const view = await startLoop(templateId, levelBand);
      router.push(`/session/${view.sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start that loop.');
    } finally {
      setStarting(null);
    }
  }

  return (
    <FlatList
      contentContainerStyle={{ padding: space.md, gap: space.md }}
      ListHeaderComponent={
        <View style={{ gap: space.xs, paddingBottom: space.sm }}>
          <Text style={{ fontSize: 26, fontWeight: '700', color: theme.plum900 }}>
            Choose a loop
          </Text>
          {error !== null ? (
            <Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text>
          ) : null}
        </View>
      }
      data={LOOP_TEMPLATES}
      keyExtractor={(t) => t.id}
      renderItem={({ item }) => {
        const track = trackById(item.trackId);
        const minutes = item.rounds.reduce((sum, r) => sum + r.minutes, 0);
        return (
          <View
            style={{
              backgroundColor: theme.raised, borderRadius: 10, borderWidth: 1,
              borderColor: theme.rule, padding: space.md, gap: space.sm,
            }}
          >
            <Text style={{ fontSize: 11, letterSpacing: 1, color: theme.plum500 }}>
              {(track?.name ?? item.trackId).toUpperCase()}
            </Text>
            <Text style={{ fontSize: 19, fontWeight: '700', color: theme.plum900 }}>{item.name}</Text>
            <Text style={{ color: theme.inkSoft, fontSize: 13, fontVariant: ['tabular-nums'] }}>
              {item.levelBand} · {item.rounds.length} rounds · {minutes} min
            </Text>
            <Text style={{ color: theme.ink, fontSize: 14 }}>{item.modeledOnNote}</Text>
            <Pressable
              onPress={() => void start(item.id, item.levelBand)}
              disabled={starting !== null}
              style={{
                backgroundColor: theme.plum700, borderRadius: 8, padding: space.sm + 4,
                alignItems: 'center', opacity: starting !== null ? 0.5 : 1,
              }}
            >
              {starting === item.id ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '700' }}>Start this loop</Text>
              )}
            </Pressable>
          </View>
        );
      }}
    />
  );
}
