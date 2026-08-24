'use client';

import { useQuery } from '@tanstack/react-query';
import { authApi } from '@/lib/api';
import type { User } from '@/types';

/**
 * The one place that turns `GET /auth/me` into role booleans.
 *
 * Every write action gated by role ultimately answers to the same three
 * questions this returns — `isAdmin`, `isAnalyst`, `canWrite` — so a screen
 * checks one of these rather than comparing `user.role === 'ADMIN'` itself.
 * The backend is still the real boundary (every `@Roles`-guarded endpoint
 * rejects a VIEWER regardless of what the UI shows); this only decides
 * whether to offer the control at all.
 *
 * Shares the `['me']` query key already used across the app (see
 * `dashboard-shell.tsx`, `use-ai-status.ts`), so this costs no extra request
 * on a session that has loaded any authenticated screen.
 */
export function useCurrentUser() {
  const query = useQuery<User>({
    queryKey: ['me'],
    queryFn: authApi.me,
    staleTime: 5 * 60_000,
  });

  const role = query.data?.role;

  return {
    user: query.data,
    isLoading: query.isLoading,
    isAdmin: role === 'ADMIN',
    isAnalyst: role === 'ANALYST',
    isViewer: role === 'VIEWER',
    /**
     * ADMIN and ANALYST may create, edit, run and delete. VIEWER is read-only
     * everywhere except downloading an already-generated report, which is a
     * read, not a write — see `ReportsController.download`.
     */
    canWrite: role === 'ADMIN' || role === 'ANALYST',
  };
}
