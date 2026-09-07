import { API_BASE_URL } from './config';
import { supabase } from './supabase';

/**
 * One fetch wrapper for every call to the product's API.
 *
 * It exists to make two things impossible to forget. Every request carries the Supabase
 * access token as `Authorization: Bearer` -- the native equivalent of the web's session
 * cookie, verified server-side by the same `authenticate()`. And every MUTATING request
 * carries an `Idempotency-Key`, which the guard chain requires on anything that spends money
 * or changes state; omitting it is a 400 that is confusing to debug at the call site.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  readonly error?: string;
  readonly code?: string;
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers: Record<string, string> = {};
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  // Every mutating route in the guard chain requires this (spec §3.2).
  if (method !== 'GET') headers['idempotency-key'] = globalThis.crypto.randomUUID();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    throw new ApiError(
      response.status,
      body.code ?? 'request_failed',
      body.error ?? `Request failed (HTTP ${response.status}).`,
    );
  }
  return (await response.json()) as T;
}

export interface SessionView {
  readonly sessionId: string;
  readonly status: 'in_progress' | 'completed' | 'abandoned' | 'expired';
  readonly trackId: string;
  readonly levelBand: string;
  readonly roundCount: number;
  readonly currentRoundPosition: number;
  readonly currentRoundType: string | null;
  readonly currentRoundId: string | null;
  readonly persona: string | null;
  readonly question: string | null;
  readonly pendingTurnId: string | null;
  readonly answeredTurnCount: number;
  readonly videoEligible: boolean;
}

export interface DebriefAttribute {
  readonly dimension: string;
  readonly name: string;
  readonly display: string;
  readonly quote: string;
  readonly lowInformation: boolean;
}

export interface DebriefPacket {
  readonly overallDisplay: string;
  readonly attributes: readonly DebriefAttribute[];
  readonly practiceFocus: readonly DebriefAttribute[];
  readonly methodNote: string;
  readonly gaps: readonly string[];
}

export const startLoop = (loopTemplateId: string, levelBand: string): Promise<SessionView> =>
  api<SessionView>('/api/sessions', { method: 'POST', body: { loopTemplateId, levelBand } });

export const loadSession = (id: string): Promise<SessionView> =>
  api<SessionView>(`/api/sessions/${id}`);

export const submitTurn = (id: string, turnId: string, transcript: string): Promise<SessionView> =>
  api<SessionView>(`/api/sessions/${id}/turns`, { method: 'POST', body: { turnId, transcript } });

export const fetchDebrief = (id: string): Promise<DebriefPacket> =>
  api<DebriefPacket>(`/api/sessions/${id}/debrief`, { method: 'POST' });

export interface UserProfile {
  readonly displayName: string | null;
  readonly jurisdiction: string;
  readonly ageBand: string;
  readonly videoOptIn: boolean;
  readonly videoEligible: boolean;
}

export const loadProfile = (): Promise<UserProfile> => api<UserProfile>('/api/users/me');

export const saveProfile = (patch: Partial<UserProfile>): Promise<UserProfile> =>
  api<UserProfile>('/api/users/me', { method: 'PATCH', body: patch });

export interface DeletionOutcome {
  readonly rowsPurged: number;
  readonly authRecordDeleted: boolean;
}

export const deleteAccount = (): Promise<DeletionOutcome> =>
  api<DeletionOutcome>('/api/users/me', { method: 'DELETE' });

/**
 * Uploads a recording for transcription.
 *
 * Not routed through `api()` because the body is raw audio bytes, not JSON -- but it carries
 * the same Bearer token and the same Idempotency-Key, which the route requires because each
 * call bills a provider.
 */
export async function transcribe(sessionId: string, fileUri: string): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const audio = await fetch(fileUri);
  const blob = await audio.blob();

  const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/audio`, {
    method: 'POST',
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      'content-type': 'audio/m4a',
      'idempotency-key': globalThis.crypto.randomUUID(),
    },
    body: blob,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    throw new ApiError(
      response.status,
      body.code ?? 'transcription_failed',
      body.error ?? 'Could not transcribe that recording.',
    );
  }
  const { transcript } = (await response.json()) as { transcript: string };
  return transcript;
}

/**
 * The URL for the interviewer speaking the current question.
 *
 * The token goes in the URL rather than a header because expo-av's player fetches the audio
 * itself and cannot be given custom headers. That is acceptable here and nowhere else: the
 * route is a GET, it returns audio for the caller's OWN session, and the token is short-lived
 * -- but it does mean this URL must never be logged or shared.
 */
export async function speechUrl(sessionId: string): Promise<{ uri: string; headers: Record<string, string> }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    uri: `${API_BASE_URL}/api/sessions/${sessionId}/speech`,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  };
}
