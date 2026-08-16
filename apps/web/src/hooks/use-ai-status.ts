'use client';

import { useQuery } from '@tanstack/react-query';
import { aiApi, authApi } from '@/lib/api';
import {
  blocksAiEnrichment,
  deriveAiAvailability,
  type AiAvailability,
} from '@/lib/ai-availability';
import type { AiProviderStatus } from '@/types';

/**
 * The single key for "can this instance run AI enrichment right now?".
 *
 * Shared so every surface that offers the option reads the same cached answer,
 * and so saving a provider in Settings can invalidate `['ai']` and have the run
 * sheet reflect it without a reload.
 */
export const AI_STATUS_KEY = ['ai', 'status'] as const;

/** Where an admin goes to fix an unconfigured provider. */
export const AI_SETTINGS_HREF = '/settings?tab=ai';

export interface AiStatusState {
  status?: AiProviderStatus;
  isLoading: boolean;
  /** True only once the API has confirmed a provider that can actually be called. */
  available: boolean;
  availability: AiAvailability;
  /** True when enrichment demonstrably cannot run — see `deriveAiAvailability`. */
  isBlocked: boolean;
  /** The provider's own explanation, when it gave one. */
  reason?: string;
  /** Provider configuration is admin-only, so the fix is not offered to everyone. */
  canConfigure: boolean;
}

export function useAiStatus(enabled = true): AiStatusState {
  const status = useQuery<AiProviderStatus>({
    queryKey: AI_STATUS_KEY,
    queryFn: aiApi.status,
    enabled,
    staleTime: 30_000,
  });

  // Shares the key the settings page already uses, so this costs no extra
  // request on a session that has loaded any authenticated screen.
  const me = useQuery({
    queryKey: ['me'],
    queryFn: authApi.me,
    enabled,
    staleTime: 5 * 60_000,
  });

  const availability = deriveAiAvailability(status.data, status.isLoading);

  return {
    status: status.data,
    isLoading: status.isLoading,
    available: status.data?.available === true,
    availability,
    isBlocked: blocksAiEnrichment(availability),
    reason: status.data?.reason,
    canConfigure: me.data?.role === 'ADMIN',
  };
}
