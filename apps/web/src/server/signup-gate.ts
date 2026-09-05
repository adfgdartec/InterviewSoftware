/**
 * Who may open an account, decided server-side before any auth user is created.
 *
 * `/compliance` states, as fact: "Accounts are gated at 13+, and 16+ in the EU." Until this
 * function existed nothing gated anything -- there was no signup, `users.age_band` defaulted
 * to `unknown`, and the sentence was aspirational. This is what makes it true.
 *
 * Pure, and shaped like `videoEligible` and `videoOptInPermitted` deliberately: the same
 * fail-closed rule, the same exhaustive table-driven tests, the same "no code path treats an
 * unset value as permission" guarantee.
 */

export const AGE_BANDS = ['unknown', 'under_13', '13_to_15', '16_plus'] as const;
export const JURISDICTIONS = ['unknown', 'eu', 'illinois', 'us_other', 'other'] as const;

export type AgeBand = (typeof AGE_BANDS)[number];
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export interface SignupGateInput {
  readonly ageBand: string;
  readonly jurisdiction: string;
}

/**
 * Regions we can positively confirm are outside the EU. Used rather than `!== 'eu'` so that a
 * value nobody has thought about yet -- a new enum member, a typo, an unset field -- fails
 * closed instead of being silently admitted.
 */
const CONFIRMED_NON_EU: readonly string[] = ['illinois', 'us_other', 'other'];

export function signupPermitted(input: SignupGateInput): boolean {
  // COPPA's verifiable-parental-consent regime is out of scope for this product, and the
  // compliance page states a 13+ floor. `unknown` is refused for the same reason an unset
  // jurisdiction is: absence of a stated age is not evidence of an eligible one.
  if (input.ageBand === 'unknown' || input.ageBand === 'under_13') return false;

  // 16+ everywhere, so the EU rule cannot bite.
  if (input.ageBand === '16_plus') return true;

  // 13-15: admitted only where the region is explicitly outside the EU. An unstated
  // jurisdiction cannot be ruled out as the EU, so it is refused rather than assumed.
  if (input.ageBand === '13_to_15') return CONFIRMED_NON_EU.includes(input.jurisdiction);

  // Any age band this function has not been taught about.
  return false;
}

/** Why a signup was refused, for copy that tells the person something useful. */
export type SignupRefusal = 'age_required' | 'under_minimum_age' | 'eu_minimum_age';

export function signupRefusalReason(input: SignupGateInput): SignupRefusal | null {
  if (signupPermitted(input)) return null;
  if (input.ageBand === 'unknown') return 'age_required';
  if (input.ageBand === 'under_13') return 'under_minimum_age';
  if (input.ageBand === '13_to_15') return 'eu_minimum_age';
  return 'age_required';
}

export const REFUSAL_MESSAGES: Readonly<Record<SignupRefusal, string>> = {
  age_required: 'Choose your age range and your region to continue.',
  under_minimum_age: 'You need to be at least 13 to use this. Nothing has been created.',
  eu_minimum_age:
    'In the European Union you need to be 16 or older to use this. Nothing has been created.',
};
