import { appBrand } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { AppLogoMark } from './app-logo-mark';

interface AppLogoProps {
  /** `icon` renders the symbol alone; `full` locks it up with the product name. */
  variant?: 'icon' | 'full';
  /** Symbol edge length in px. */
  size?: number;
  className?: string;
  /** Class applied to the wordmark, for surfaces with their own type scale. */
  nameClassName?: string;
}

/**
 * The product mark — the only place the logo and the product name are drawn
 * together.
 *
 * Before this, the sidebar, login, register, invite and OAuth-callback screens
 * each hardcoded their own `<span>IASA</span>` at four different font sizes, so
 * a rename touched five files and the sizes never matched. All of them now read
 * `appBrand.name` through here.
 *
 * Accessibility: in `full` the symbol is decorative, because the name sits
 * beside it as real text — labelling the SVG as well would make a screen reader
 * announce "API Analyser API Analyser". In `icon` the symbol carries the
 * accessible name, since nothing else does.
 */
export function AppLogo({
  variant = 'full',
  size = 28,
  className,
  nameClassName,
}: AppLogoProps) {
  if (variant === 'icon') {
    return (
      <span className={cn('inline-flex shrink-0 items-center text-foreground', className)}>
        <AppLogoMark size={size} title={appBrand.name} />
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-2 text-foreground', className)}>
      <AppLogoMark size={size} />
      <span className={cn('font-semibold tracking-tight whitespace-nowrap', nameClassName)}>
        {appBrand.name}
      </span>
    </span>
  );
}
