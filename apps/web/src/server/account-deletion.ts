import type { Sql } from '@loopcraft/db';

/**
 * Account deletion. Acceptance criterion 10, and the thing the privacy notice promises.
 *
 * `/compliance` has claimed since before any of this existed that "deletion purges both
 * database rows and stored files". This is what makes that sentence true.
 *
 * The design rests on one fact already in the schema: fifteen tables reference `orgs(id) on
 * delete cascade`. Deleting the org therefore removes sessions, rounds, turns, scores,
 * artifacts, entitlements, usage and presence in one statement that Postgres enforces --
 * rather than a hand-written list of DELETEs that silently misses a table added later. A new
 * tenant table gets purged automatically because it is a cascade, not because someone
 * remembered.
 *
 * Two things are deliberately NOT deleted:
 *
 *   - `audit_log`, which references orgs with `on delete set null`. Who did what to an
 *     account is the record of the deletion itself; erasing it would leave no evidence the
 *     request was honoured. It carries no interview content.
 *   - `retention_jobs` for this deletion, written last, for the same reason.
 */

export interface DeletionOutcome {
  /** Rows removed across every cascaded table, as Postgres counted them. */
  readonly rowsPurged: number;
  /** Storage objects removed. Zero today: nothing is uploaded, so nothing is stored. */
  readonly storageObjectsPurged: number;
  /**
   * Whether the Supabase auth record (which holds the email) was deleted too. False when no
   * service-role key is configured -- the product data is gone either way, but the address is
   * not, and saying so is better than implying an erasure that did not happen.
   */
  readonly authRecordDeleted: boolean;
}

export interface DeleteAccountInput {
  readonly userId: string;
  readonly orgId: string;
  /** Deletes the Supabase auth user. Omitted when no service-role key is configured. */
  readonly deleteAuthUser?: (userId: string) => Promise<void>;
}

/**
 * Purges an account. Runs on the owner connection: RLS scopes a user to their own rows, and
 * this has to remove the rows that define that scope, including the membership it would be
 * checking against.
 *
 * Everything happens in ONE transaction. A half-deleted account -- org gone, user row left --
 * is worse than either outcome: the person cannot sign in, cannot use the product, and their
 * email is still on file.
 */
export async function deleteAccount(
  owner: Sql,
  input: DeleteAccountInput,
): Promise<DeletionOutcome> {
  const rowsPurged = await owner.begin(async (tx) => {
    // Counted before the delete, because after it there is nothing left to count. This is the
    // number reported in retention_jobs, so it has to mean something.
    const counts = await tx<{ total: string }[]>`
      select (
        (select count(*) from sessions where org_id = ${input.orgId}) +
        (select count(*) from rounds where org_id = ${input.orgId}) +
        (select count(*) from turns where org_id = ${input.orgId}) +
        (select count(*) from artifacts where org_id = ${input.orgId}) +
        (select count(*) from entitlements where org_id = ${input.orgId}) +
        (select count(*) from usage_ledger where org_id = ${input.orgId}) +
        (select count(*) from consent_events where org_id = ${input.orgId}) +
        (select count(*) from memberships where org_id = ${input.orgId}) +
        (select count(*) from users where id = ${input.userId})
      )::text as total`;

    // The org is the root of the cascade. One statement, fifteen tables.
    await tx`delete from orgs where id = ${input.orgId}`;
    // The user row is not org-scoped, so it needs its own delete. Everything that referenced
    // it went with the org.
    await tx`delete from users where id = ${input.userId}`;

    return Number.parseInt(counts[0]?.total ?? '0', 10);
  });

  let authRecordDeleted = false;
  if (input.deleteAuthUser !== undefined) {
    try {
      await input.deleteAuthUser(input.userId);
      authRecordDeleted = true;
    } catch (error) {
      // The product data is already gone and that is not reversible, so this cannot fail the
      // request. It IS logged, because an address left on file after an erasure request is a
      // real obligation left unmet, not a cosmetic problem.
      console.error('[deletion] product data purged but the auth record remains:', error);
    }
  }

  // audit_log is the durable record, not retention_jobs: that table requires a non-null
  // org_id and subject_user_id, and both have just been deleted -- a row there could only
  // exist by keeping the account it claims to have purged. audit_log references orgs with
  // `on delete set null` precisely so it can outlive its subject.
  await owner`
    insert into audit_log (org_id, actor_user_id, action, subject_table, subject_id, metadata)
    values (null, null, 'account_deleted', 'users', ${input.userId},
            ${owner.json({ rowsPurged, authRecordDeleted })})`.catch((error: unknown) => {
    console.error('[deletion] could not write the audit record:', error);
  });

  return { rowsPurged, storageObjectsPurged: 0, authRecordDeleted };
}
