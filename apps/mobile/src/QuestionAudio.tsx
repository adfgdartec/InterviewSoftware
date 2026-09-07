import { useEffect, useRef, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Audio } from 'expo-av';
import { speechUrl } from './api';
import { theme, space } from './theme';

/**
 * The interviewer speaking the question aloud.
 *
 * Audio is an enhancement, never a blocker: the question text is on screen either way, so a
 * 503 (text-to-speech unconfigured) or a network failure renders nothing rather than an error
 * the candidate can do nothing about.
 *
 * Unlike the web, there is no autoplay policy to fight -- but the sound is still loaded and
 * played explicitly so a candidate on a phone in public can choose not to.
 */
export function QuestionAudio({ sessionId, questionText }: { sessionId: string; questionText: string }) {
  const [state, setState] = useState<'idle' | 'playing' | 'unavailable'>('idle');
  const sound = useRef<Audio.Sound | null>(null);

  // A new question is new audio. Unloading first stops the previous one talking over it.
  useEffect(() => {
    return () => {
      void sound.current?.unloadAsync();
      sound.current = null;
    };
  }, [questionText]);

  async function play(): Promise<void> {
    try {
      await sound.current?.unloadAsync();
      const { uri, headers } = await speechUrl(sessionId);
      const { sound: loaded } = await Audio.Sound.createAsync(
        { uri, headers },
        { shouldPlay: true },
      );
      sound.current = loaded;
      setState('playing');
      loaded.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) setState('idle');
      });
    } catch {
      setState('unavailable');
    }
  }

  if (state === 'unavailable') return null;

  return (
    <Pressable
      onPress={() => void play()}
      style={{
        alignSelf: 'flex-start', borderWidth: 1, borderColor: theme.roomRule,
        borderRadius: 8, paddingVertical: space.sm, paddingHorizontal: space.md,
      }}
    >
      <Text style={{ color: theme.roomInk, fontWeight: '600' }}>
        {state === 'playing' ? 'Speaking…' : 'Hear the question'}
      </Text>
    </Pressable>
  );
}
