'use client';

import { useEffect, useState } from 'react';
import { IconAlertTriangle } from '@tabler/icons-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/security/finding-status-badge';
import { ISSUE_STATUSES_REQUIRING_REASON } from '@/types';
import type { IssueStatus } from '@/types';

/**
 * The triage form.
 *
 * Replaces `window.prompt`. The prompt was not merely ugly — it could not be
 * styled, trapped focus outside the app, was blocked outright by some browser
 * configurations, offered no validation beyond "non-empty", and had nowhere to
 * put the expiry date that ACCEPTED_RISK genuinely needs. The reason it
 * captured is written to `IssueStatusChange` and is the permanent audit record
 * of a security decision, so it deserves a real form.
 *
 * Two rules the backend enforces and this dialog surfaces up front:
 *   - RESOLVED, FALSE_POSITIVE and ACCEPTED_RISK require a justification.
 *   - ACCEPTED_RISK may carry an expiry, after which the issue reopens by
 *     itself. FALSE_POSITIVE never reopens automatically.
 */
export function IssueTriageDialog({
  open,
  onOpenChange,
  targetStatus,
  currentStatus,
  isSubmitting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  /** The status being moved to. Null closes the dialog. */
  targetStatus: IssueStatus | null;
  currentStatus: IssueStatus;
  isSubmitting: boolean;
  onConfirm: (_payload: {
    status: IssueStatus;
    reason?: string;
    acceptedRiskUntil?: string;
  }) => void;
}) {
  const [reason, setReason] = useState('');
  const [acceptedRiskUntil, setAcceptedRiskUntil] = useState('');

  // Reset whenever a new decision is started, so a justification typed for one
  // status can never be submitted against another.
  useEffect(() => {
    if (open) {
      setReason('');
      setAcceptedRiskUntil('');
    }
  }, [open, targetStatus]);

  if (!targetStatus) return null;

  const requiresReason = ISSUE_STATUSES_REQUIRING_REASON.includes(targetStatus);
  const isAcceptedRisk = targetStatus === 'ACCEPTED_RISK';
  const reasonValid = !requiresReason || reason.trim().length > 0;

  const label = targetStatus.replace(/_/g, ' ').toLowerCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>Change status to</span>
            <StatusBadge status={targetStatus} />
          </DialogTitle>
          <DialogDescription>
            Moving from <span className="font-medium">{currentStatus.replace(/_/g, ' ').toLowerCase()}</span> to{' '}
            <span className="font-medium">{label}</span>. This is recorded in the issue&apos;s triage
            history with your name and the time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {requiresReason && (
            <div>
              <Label htmlFor="triage-reason" className="mb-1.5 block text-xs font-medium">
                Justification <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="triage-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                maxLength={2000}
                autoFocus
                placeholder={
                  targetStatus === 'FALSE_POSITIVE'
                    ? 'Explain why the scanner evidence does not represent a real vulnerability.'
                    : targetStatus === 'ACCEPTED_RISK'
                      ? 'Explain why this risk is being accepted, and who accepted it.'
                      : 'Describe the fix that was applied and how it was verified.'
                }
                aria-describedby="triage-reason-hint"
              />
              <p id="triage-reason-hint" className="mt-1 text-xs text-muted-foreground">
                {reason.trim().length}/2000 · Required for this decision and kept permanently.
              </p>
            </div>
          )}

          {isAcceptedRisk && (
            <div>
              <Label htmlFor="triage-expiry" className="mb-1.5 block text-xs font-medium">
                Acceptance expires (optional)
              </Label>
              <Input
                id="triage-expiry"
                type="date"
                value={acceptedRiskUntil}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setAcceptedRiskUntil(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                The issue reopens automatically after this date if it is still detected. Leave
                empty to accept the risk indefinitely.
              </p>
            </div>
          )}

          {targetStatus === 'FALSE_POSITIVE' && (
            <p className="flex items-start gap-1.5 rounded-md border border-severity-medium/30 bg-severity-medium/5 px-3 py-2 text-xs text-muted-foreground">
              <IconAlertTriangle
                className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-severity-medium"
                aria-hidden="true"
              />
              <span>
                A false positive is never reopened automatically, even if later scans detect it
                again. Use Accepted risk if the finding is real but tolerated.
              </span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            disabled={!reasonValid || isSubmitting}
            onClick={() =>
              onConfirm({
                status: targetStatus,
                reason: reason.trim() || undefined,
                acceptedRiskUntil: acceptedRiskUntil
                  ? new Date(`${acceptedRiskUntil}T00:00:00.000Z`).toISOString()
                  : undefined,
              })
            }
          >
            {isSubmitting ? 'Saving…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
