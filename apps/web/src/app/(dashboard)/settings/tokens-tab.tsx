'use client';

import { IconKey, IconLock } from '@tabler/icons-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { SettingsPanel, SettingsSection } from './_components/settings-primitives';

/**
 * Settings → API tokens.
 *
 * Honestly unavailable. The `ApiKey` model exists in the schema (name, keyHash,
 * keyPreview, scopes, expiresAt, lastUsedAt) but no controller or service reads
 * it, so there is no route to create, list or revoke a token.
 *
 * This tab used to render two hardcoded entries with client-only create and
 * revoke, whose "copy" button copied the masked placeholder rather than a real
 * credential. A working-looking token manager that issues nothing is worse than
 * an empty state, because the user believes they hold a credential.
 *
 * The table, the "Create API token" dialog and the row menu are therefore not
 * built here either — not even disabled. Greyed-out controls still imply the
 * capability exists and is merely switched off, and the whole point of this
 * screen is that it does not.
 */
export function TokensTab() {
  return (
    <div className="space-y-5">
      <SettingsPanel>
        <SettingsSection title="Tokens" description="Not available in this build.">
          <EmptyState
            icon={IconKey}
            title="API tokens are not available yet"
            description="Programmatic access is not implemented. Once it ships you will be able to create named tokens with scopes and an expiry, see when each was last used, and revoke them at any time."
          />
        </SettingsSection>
      </SettingsPanel>

      <Alert variant="default">
        <IconLock />
        <div>
          <p className="mb-1 text-xs font-medium text-foreground">How tokens will work</p>
          <AlertDescription className="text-xs">
            The full value will be shown once at creation and never again — only a masked preview is
            stored. Keep tokens in environment variables, never in version control, and revoke any
            token you suspect has been exposed. Use your browser session in the meantime.
          </AlertDescription>
        </div>
      </Alert>
    </div>
  );
}
