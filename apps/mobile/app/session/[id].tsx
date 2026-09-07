import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  fetchDebrief, loadSession, submitTurn,
  type DebriefPacket, type SessionView,
} from '../../src/api';
import { theme, space } from '../../src/theme';
import { VoiceAnswer } from '../../src/VoiceAnswer';
import { QuestionAudio } from '../../src/QuestionAudio';

/**
 * The loop itself. Same inversion as the web session page: while a loop is running this is a
 * dark room with one question, and when it completes the debrief renders on paper.
 *
 * There is no grading, no question generation and no entitlement logic here -- all of it
 * happens behind the same API the web app calls. This screen is a view over that.
 */
export default function Session() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [view, setView] = useState<SessionView | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debrief, setDebrief] = useState<DebriefPacket | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setView(await loadSession(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this session.');
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit(): Promise<void> {
    if (view === null || view.pendingTurnId === null || answer.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      setView(await submitTurn(id, view.pendingTurnId, answer.trim()));
      setAnswer('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit that answer.');
    } finally {
      setBusy(false);
    }
  }

  async function grade(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setDebrief(await fetchDebrief(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not grade this loop.');
    } finally {
      setBusy(false);
    }
  }

  if (view === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {error === null ? (
          <ActivityIndicator color={theme.plum700} />
        ) : (
          <Text accessibilityRole="alert" style={{ color: theme.danger, textAlign: 'center', padding: space.lg }}>
            {error}
          </Text>
        )}
      </View>
    );
  }

  if (debrief !== null) {
    return (
      <ScrollView contentContainerStyle={{ padding: space.md, gap: space.md }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: theme.plum900 }}>Debrief</Text>
        <Text style={{ fontSize: 40, fontWeight: '700', color: theme.plum900, fontVariant: ['tabular-nums'] }}>
          {debrief.overallDisplay}
        </Text>
        {/* The method note travels with the number, exactly as acceptance criterion 8 requires
            on every surface -- a second client is not an exception to it. */}
        <Text style={{ color: theme.inkSoft, fontSize: 13 }}>{debrief.methodNote}</Text>

        {debrief.practiceFocus.length > 0 ? (
          <View style={{ backgroundColor: theme.gold100, borderRadius: 10, padding: space.md, gap: space.xs }}>
            <Text style={{ fontSize: 11, letterSpacing: 1, color: theme.plum900 }}>PRACTISE THESE NEXT</Text>
            <Text style={{ color: theme.ink, fontSize: 15 }}>
              {debrief.practiceFocus.map((a) => a.name).join(' · ')}
            </Text>
          </View>
        ) : null}

        {debrief.attributes.map((a) => (
          <View
            key={a.dimension}
            style={{
              backgroundColor: theme.raised, borderRadius: 10, borderWidth: 1,
              borderColor: theme.rule, padding: space.md, gap: space.xs,
            }}
          >
            <Text style={{ fontSize: 11, letterSpacing: 1, color: theme.plum500 }}>
              {a.name.toUpperCase()}
            </Text>
            <Text style={{ fontSize: 22, fontWeight: '700', color: theme.plum900, fontVariant: ['tabular-nums'] }}>
              {a.display}
            </Text>
            {a.quote !== '' ? (
              <Text style={{ color: theme.ink, fontStyle: 'italic', fontSize: 14 }}>“{a.quote}”</Text>
            ) : null}
          </View>
        ))}
      </ScrollView>
    );
  }

  if (view.status === 'completed') {
    return (
      <View style={{ flex: 1, padding: space.lg, gap: space.md, justifyContent: 'center' }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: theme.plum900 }}>Loop complete</Text>
        <Text style={{ color: theme.inkSoft }}>
          {view.answeredTurnCount} rounds answered. Grading runs three independent samples per
          dimension, so this takes a moment.
        </Text>
        {error !== null ? <Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text> : null}
        <Pressable
          onPress={() => void grade()}
          disabled={busy}
          style={{ backgroundColor: theme.plum700, borderRadius: 8, padding: space.md, alignItems: 'center', opacity: busy ? 0.5 : 1 }}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Get your debrief</Text>}
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.roomFloor }}
      contentContainerStyle={{ padding: space.md, gap: space.md, flexGrow: 1 }}
    >
      <Text style={{ fontSize: 11, letterSpacing: 1, color: theme.roomInk2 }}>
        {`${view.trackId.toUpperCase()} · ROUND ${view.currentRoundPosition} OF ${view.roundCount}`}
      </Text>

      <View style={{ backgroundColor: theme.roomStage, borderRadius: 12, padding: space.md, gap: space.sm }}>
        <Text style={{ fontSize: 11, letterSpacing: 1, color: theme.gold600 }}>QUESTION</Text>
        <Text style={{ fontSize: 22, lineHeight: 30, color: theme.roomInk }}>{view.question}</Text>
        <QuestionAudio sessionId={id} questionText={view.question ?? ''} />
      </View>

      <Text style={{ fontSize: 11, letterSpacing: 1, color: theme.roomInk2 }}>YOUR ANSWER</Text>
      <TextInput
        value={answer}
        onChangeText={setAnswer}
        multiline
        editable={!busy}
        placeholder="Type your answer here."
        placeholderTextColor={theme.roomInk2}
        style={{
          minHeight: 160, borderWidth: 1, borderColor: theme.roomRule, borderRadius: 10,
          padding: space.md, color: theme.roomInk, fontSize: 16, textAlignVertical: 'top',
          backgroundColor: theme.roomWall,
        }}
      />

      {/* The transcript lands in the same box the candidate types in, so it can be read and
          corrected before submitting -- a transcription error should cost a correction, not
          a score. */}
      <VoiceAnswer sessionId={id} disabled={busy} onTranscribed={setAnswer} />

      {error !== null ? <Text accessibilityRole="alert" style={{ color: theme.danger }}>{error}</Text> : null}

      <Pressable
        onPress={() => void submit()}
        disabled={busy || answer.trim() === ''}
        style={{
          backgroundColor: theme.gold600, borderRadius: 8, padding: space.md,
          alignItems: 'center', opacity: busy || answer.trim() === '' ? 0.5 : 1,
        }}
      >
        {busy ? (
          <ActivityIndicator color="#2a2229" />
        ) : (
          <Text style={{ color: '#2a2229', fontWeight: '700', fontSize: 16 }}>Submit answer</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
