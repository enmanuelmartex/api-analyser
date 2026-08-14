import { describe, expect, it } from 'bun:test';
import { deliveryKey, planRecipients } from './report-recipients';

/**
 * Who gets the mail.
 *
 * The two failure modes this guards are asymmetric and both bad: a security
 * report reaching an address that should not have it, and a report nobody
 * received and nobody knew was missing.
 */

const OWNER = { userId: 'user_1', email: 'owner@example.com' };

describe('planRecipients', () => {
  it('returns nothing when nothing is configured and the owner opted out', () => {
    expect(
      planRecipients({ configured: [], installEnabled: true, owner: OWNER, ownerWants: false }),
    ).toEqual([]);
  });

  it('includes the owner when their own preferences say so', () => {
    expect(
      planRecipients({ configured: [], installEnabled: true, owner: OWNER, ownerWants: true }),
    ).toEqual([{ address: 'owner@example.com', userId: 'user_1' }]);
  });

  it('includes the configured addresses, with no user attached', () => {
    expect(
      planRecipients({
        configured: ['security@corp.example'],
        installEnabled: true,
        owner: OWNER,
        ownerWants: false,
      }),
    ).toEqual([{ address: 'security@corp.example' }]);
  });

  it('keeps the two sources independent', () => {
    // An administrator adding a team mailbox must not start mailing owners who
    // had opted out, and an owner opting in must not be blocked by the switch.
    const configuredOnly = planRecipients({
      configured: ['security@corp.example'],
      installEnabled: true,
      owner: OWNER,
      ownerWants: false,
    });
    const ownerOnly = planRecipients({
      configured: ['security@corp.example'],
      installEnabled: false,
      owner: OWNER,
      ownerWants: true,
    });

    expect(configuredOnly.map((r) => r.address)).toEqual(['security@corp.example']);
    expect(ownerOnly.map((r) => r.address)).toEqual(['owner@example.com']);
  });

  it('drops the configured list when the install switch is off', () => {
    expect(
      planRecipients({
        configured: ['a@corp.example', 'b@corp.example'],
        installEnabled: false,
        owner: null,
        ownerWants: false,
      }),
    ).toEqual([]);
  });

  it('puts configured addresses before the owner', () => {
    const planned = planRecipients({
      configured: ['a@corp.example', 'b@corp.example'],
      installEnabled: true,
      owner: OWNER,
      ownerWants: true,
    });

    expect(planned.map((r) => r.address)).toEqual([
      'a@corp.example',
      'b@corp.example',
      'owner@example.com',
    ]);
  });

  describe('de-duplication', () => {
    it('sends one copy to an owner who is also on the configured list', () => {
      const planned = planRecipients({
        configured: ['owner@example.com'],
        installEnabled: true,
        owner: OWNER,
        ownerWants: true,
      });

      expect(planned).toHaveLength(1);
    });

    it('matches case-insensitively', () => {
      // One mailbox everywhere that matters; two copies would be a bug the
      // operator has to notice to report.
      const planned = planRecipients({
        configured: ['OWNER@Example.COM'],
        installEnabled: true,
        owner: OWNER,
        ownerWants: true,
      });

      expect(planned).toHaveLength(1);
    });

    it('attributes the surviving copy to the user account', () => {
      const planned = planRecipients({
        configured: ['OWNER@Example.COM'],
        installEnabled: true,
        owner: OWNER,
        ownerWants: true,
      });

      // The delivery row is more useful linked to a user than floating.
      expect(planned[0].userId).toBe('user_1');
      // The address keeps the form it was first seen in, rather than being
      // rewritten under the operator.
      expect(planned[0].address).toBe('OWNER@Example.COM');
    });

    it('collapses duplicates within the configured list itself', () => {
      const planned = planRecipients({
        configured: ['a@corp.example', 'A@CORP.EXAMPLE', 'b@corp.example'],
        installEnabled: true,
        owner: null,
        ownerWants: false,
      });

      expect(planned.map((r) => r.address)).toEqual(['a@corp.example', 'b@corp.example']);
    });
  });

  describe('a missing or unusable owner', () => {
    it('still mails the configured addresses', () => {
      // A deactivated owner is not a reason to stop telling the security team.
      const planned = planRecipients({
        configured: ['security@corp.example'],
        installEnabled: true,
        owner: null,
        ownerWants: true,
      });

      expect(planned.map((r) => r.address)).toEqual(['security@corp.example']);
    });

    it('ignores an owner with no address on file', () => {
      expect(
        planRecipients({
          configured: [],
          installEnabled: true,
          owner: { userId: 'user_1', email: '' },
          ownerWants: true,
        }),
      ).toEqual([]);
    });
  });

  it('ignores blank entries in the configured list', () => {
    expect(
      planRecipients({
        configured: ['', '   ', 'a@corp.example'],
        installEnabled: true,
        owner: null,
        ownerWants: false,
      }),
    ).toEqual([{ address: 'a@corp.example' }]);
  });

  it('trims surrounding whitespace', () => {
    const planned = planRecipients({
      configured: ['  a@corp.example  '],
      installEnabled: true,
      owner: null,
      ownerWants: false,
    });

    expect(planned[0].address).toBe('a@corp.example');
  });
});

describe('deliveryKey', () => {
  it('is stable for the same report and address', () => {
    expect(deliveryKey('report-ready', 'report_1', 'a@corp.example')).toBe(
      'report-ready:report_1:a@corp.example',
    );
  });

  it('normalises case, so one mailbox cannot get two copies', () => {
    // The unique index is the durable guard, and it can only work if the key is
    // normalised the same way every time.
    expect(deliveryKey('report-ready', 'report_1', 'A@Corp.Example')).toBe(
      deliveryKey('report-ready', 'report_1', 'a@corp.example'),
    );
  });

  it('distinguishes different reports and different addresses', () => {
    const a = deliveryKey('report-ready', 'report_1', 'a@corp.example');
    expect(a).not.toBe(deliveryKey('report-ready', 'report_2', 'a@corp.example'));
    expect(a).not.toBe(deliveryKey('report-ready', 'report_1', 'b@corp.example'));
    expect(a).not.toBe(deliveryKey('scan-failed', 'report_1', 'a@corp.example'));
  });
});
