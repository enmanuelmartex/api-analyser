/**
 * Who receives the mail for one scan.
 *
 * A pure function, deliberately. Deciding this correctly matters more than
 * almost anything else in the email pipeline — the failure modes are "a
 * security report went to an address that should not have it" and "the report
 * nobody received and nobody knew was missing" — and neither is something to
 * discover by reading a queue processor that also loads PDFs off disk.
 */

export interface OwnerRecipient {
  userId: string;
  email: string;
}

export interface PlannedRecipient {
  address: string;
  /**
   * Set only when the address belongs to a user of this installation, so the
   * delivery row links to them. A configured team mailbox has no user, which is
   * the normal case and not a defect.
   */
  userId?: string;
}

export interface RecipientPlanInput {
  /** `notifications.reportRecipients` — addresses configured for the install. */
  configured: readonly string[];
  /** The install-level switch for this kind of mail. */
  installEnabled: boolean;
  /** The project owner, when they are active and have an address on file. */
  owner: OwnerRecipient | null;
  /** Whether the owner's own notification preferences include this mail. */
  ownerWants: boolean;
}

/**
 * Merges the two independent sources of recipients into one list.
 *
 * They are independent on purpose, and the distinction is the whole model:
 *
 *   - **Configured addresses** belong to the installation. They are usually a
 *     team mailbox or a ticketing inbox, frequently not users at all, and they
 *     are governed by the install-level switch an administrator controls.
 *   - **The owner's own address** is governed by the owner's own preferences,
 *     exactly as before. An administrator adding a team mailbox must not
 *     silently start mailing every project owner who had opted out.
 *
 * The owner appearing in both is the interesting case, and it is why this
 * returns a merged list rather than two: an operator who is also on
 * `security@` should get one report, not two, and the copy they get should be
 * the one attributed to their user account.
 */
export function planRecipients(input: RecipientPlanInput): PlannedRecipient[] {
  const planned: PlannedRecipient[] = [];
  const seen = new Map<string, number>();

  const add = (rawAddress: string, userId?: string) => {
    const address = rawAddress.trim();
    if (address.length === 0) return;

    const key = address.toLowerCase();
    const existing = seen.get(key);

    if (existing === undefined) {
      seen.set(key, planned.length);
      planned.push(userId ? { address, userId } : { address });
      return;
    }

    // Already present. Upgrade it to the user-attributed form if this pass
    // knows who it belongs to and the earlier one did not — the delivery row is
    // more useful linked to a user than floating.
    const current = planned[existing];
    if (userId && current && !current.userId) {
      planned[existing] = { address: current.address, userId };
    }
  };

  if (input.installEnabled) {
    for (const address of input.configured) add(address);
  }

  if (input.ownerWants && input.owner?.email) {
    add(input.owner.email, input.owner.userId);
  }

  return planned;
}

/**
 * The idempotency key for one message to one address.
 *
 * Keyed on the address rather than on a user id, because most recipients have
 * no user id. Lower-cased so that adding `Security@corp.com` to a list that
 * already contains `security@corp.com` cannot produce a second copy of the same
 * report — the unique index is the durable guard, and it can only work if the
 * key is normalised the same way every time.
 */
export function deliveryKey(prefix: string, entityId: string, address: string): string {
  return `${prefix}:${entityId}:${address.trim().toLowerCase()}`;
}

/**
 * The idempotency key for one user's digest for one week.
 *
 * Keyed on the WEEK, never on the send date. That distinction is what makes the
 * scheduler's catch-up window safe: a digest queued on Monday and a digest
 * queued on Wednesday after an outage both describe the same week, produce the
 * same key, and therefore cannot both be delivered.
 */
export function weeklyDeliveryKey(weekStart: string, address: string): string {
  return deliveryKey('weekly-summary', weekStart, address);
}
