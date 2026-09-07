import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Audio } from 'expo-av';
import { transcribe } from './api';
import { theme, space } from './theme';

/**
 * Answering out loud, the native counterpart of the web's VoiceAnswerButton.
 *
 * Recording happens with expo-av and the file is uploaded to the same
 * `/api/sessions/:id/audio` route the web client uses -- which already accepts a Bearer token,
 * already requires an Idempotency-Key because each call bills Deepgram, and already returns
 * 503 rather than a fabricated transcript when speech-to-text is unconfigured.
 *
 * The transcript is handed back for the candidate to READ AND EDIT before submitting, exactly
 * as on the web: a transcription error should cost a correction, not a score.
 */
export function VoiceAnswer({
  sessionId,
  disabled,
  onTranscribed,
}: {
  sessionId: string;
  disabled: boolean;
  onTranscribed: (text: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<Audio.Recording | null>(null);

  async function start(): Promise<void> {
    setError(null);
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone access is off for this app. Turn it on in Settings.');
        return;
      }
      // iOS records to the earpiece and stays silent on playback without this.
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recorder.current = rec;
      setRecording(true);
    } catch {
      setError('Could not start recording.');
    }
  }

  async function stop(): Promise<void> {
    const rec = recorder.current;
    if (rec === null) return;
    setRecording(false);
    setBusy(true);
    try {
      await rec.stopAndUnloadAsync();
      // Release the recording route, or playback of the next question stays silent on iOS.
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const uri = rec.getURI();
      if (uri === null) throw new Error('no recording');
      onTranscribed(await transcribe(sessionId, uri));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not transcribe that recording.');
    } finally {
      recorder.current = null;
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.xs }}>
      <Pressable
        onPress={() => void (recording ? stop() : start())}
        disabled={disabled || busy}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
          borderWidth: 1, borderColor: recording ? theme.danger : theme.roomRule,
          borderRadius: 8, padding: space.md, opacity: disabled || busy ? 0.5 : 1,
        }}
      >
        {busy ? (
          <ActivityIndicator color={theme.roomInk2} />
        ) : (
          <View
            style={{
              width: 10, height: 10, borderRadius: 5,
              backgroundColor: recording ? theme.danger : theme.roomInk2,
            }}
          />
        )}
        <Text style={{ color: recording ? theme.danger : theme.roomInk, fontWeight: '600' }}>
          {busy ? 'Transcribing…' : recording ? 'Stop recording' : 'Answer by voice'}
        </Text>
      </Pressable>
      {error !== null ? (
        <Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
      ) : null}
    </View>
  );
}
