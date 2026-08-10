'use client';

import { IconShieldCheck, IconStack2 } from '@tabler/icons-react';
import { SectionTabs } from '@/components/layout/section-tabs';

/**
 * Navigation between the two Security Checks views.
 *
 * Profiles used to be a sibling of "Installed Plugins" in the sidebar. It is a
 * saved selection *of* checks, not a peer concept, so it belongs inside this
 * screen — which is also what keeps Security Checks a single sidebar entry.
 */
export function SecurityChecksTabs({ active }: { active: 'checks' | 'profiles' }) {
  return (
    <SectionTabs
      ariaLabel="Security Checks sections"
      activeId={active}
      tabs={[
        { id: 'checks', label: 'Checks', href: '/plugins', icon: IconShieldCheck },
        { id: 'profiles', label: 'Scan Profiles', href: '/plugins/profiles', icon: IconStack2 },
      ]}
    />
  );
}
