'use client';

import { useEffect, useState, type ReactElement } from 'react';

interface Profile {
  displayName: string | null;
  jurisdiction: string;
  ageBand: string;
  videoOptIn: boolean;
  videoEligible: boolean;
}

const JURISDICTIONS: readonly { value: string; label: string }[] = [
  { value: 'unknown', label: 'Not set' },
  { value: 'eu', label: 'European Union' },
  { value: 'illinois', label: 'Illinois' },
  { value: 'us_other', label: 'Another US state' },
  { value: 'other', label: 'Elsewhere' },
];

const AGE_BANDS: readonly { value: string; label: string }[] = [
  { value: 'unknown', label: 'Not set' },
  { value: 'under_13', label: 'Under 13' },
  { value: '13_to_15', label: '13–15' },
  { value: '16_plus', label: '16 or older' },
];

const INPUT_CLASS =
  'mt-2 w-full rounded-md border border-neutral-200 p-2 text-sm text-neutral-900 focus:border-gold-600 focus:outline-none focus:ring-2 focus:ring-gold-600';

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/**
 * Jurisdiction and age band are self-reported, not verified -- there is no identity
 * verification service in this product. The video opt-in toggle is disabled until both are
 * set to an eligible value: a disabled control with an explanation is more honest than one
 * that silently vanishes.
 */
export default function SettingsPage(): ReactElement {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const res = await fetch('/api/users/me');
      if (cancelled) return;
      if (!res.ok) {
        setError('Could not load your settings.');
        return;
      }
      setProfile(await readJson<Profile>(res));
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: Partial<Profile>): Promise<void> {
    if (profile === null) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch('/api/users/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const body = await readJson<{ error?: string }>(res);
      setError(body.error ?? `Could not save (HTTP ${res.status}).`);
      setSaving(false);
      return;
    }
    setProfile(await readJson<Profile>(res));
    setSaving(false);
    setSaved(true);
  }

  if (profile === null && error === null) {
    return <p className="text-neutral-600">Loading your settings…</p>;
  }

  const eligibleForOptIn =
    profile !== null && profile.jurisdiction !== 'unknown' && profile.ageBand !== 'unknown';

  return (
    <>
      <h1 className="text-3xl font-bold text-plum-900">Settings</h1>
      <p className="mt-2 max-w-[65ch] text-neutral-600">
        Your region and age band are self-reported — we don&rsquo;t verify them. They control
        whether the optional camera framing check is available to you.
      </p>

      {error !== null ? (
        <p role="alert" className="mt-4 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      {profile !== null ? (
        <div className="mt-6 max-w-[480px] rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <label htmlFor="displayName" className="block text-sm font-medium text-neutral-900">
            Display name
          </label>
          <input
            id="displayName"
            type="text"
            defaultValue={profile.displayName ?? ''}
            disabled={saving}
            className={INPUT_CLASS}
            onBlur={(e) => void save({ displayName: e.target.value })}
          />

          <label htmlFor="jurisdiction" className="mt-5 block text-sm font-medium text-neutral-900">
            Region
          </label>
          <select
            id="jurisdiction"
            value={profile.jurisdiction}
            disabled={saving}
            className={INPUT_CLASS}
            onChange={(e) => void save({ jurisdiction: e.target.value })}
          >
            {JURISDICTIONS.map((j) => (
              <option key={j.value} value={j.value}>
                {j.label}
              </option>
            ))}
          </select>

          <label htmlFor="ageBand" className="mt-5 block text-sm font-medium text-neutral-900">
            Age
          </label>
          <select
            id="ageBand"
            value={profile.ageBand}
            disabled={saving}
            className={INPUT_CLASS}
            onChange={(e) => void save({ ageBand: e.target.value })}
          >
            {AGE_BANDS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-neutral-600">Self-reported. We don&rsquo;t verify this.</p>

          <div className="mt-6 flex items-start gap-3 border-t border-neutral-200 pt-5">
            <input
              id="videoOptIn"
              type="checkbox"
              checked={profile.videoOptIn}
              disabled={saving || !eligibleForOptIn}
              onChange={(e) => void save({ videoOptIn: e.target.checked })}
              className="mt-1"
            />
            <div>
              <label htmlFor="videoOptIn" className="text-sm font-medium text-neutral-900">
                Enable the camera framing check
              </label>
              <p className="mt-1 text-xs text-neutral-600">
                {eligibleForOptIn
                  ? 'Optional. Off by default. Checks how you’re framed in your camera before recording an answer — nothing is ever uploaded or stored.'
                  : 'Available once your region and age are set to an eligible value above.'}
              </p>
            </div>
          </div>

          {saved ? <p className="mt-4 text-sm text-neutral-600">Saved.</p> : null}
        </div>
      ) : null}
    </>
  );
}
