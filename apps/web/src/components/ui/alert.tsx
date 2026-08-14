import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * An inline notice.
 *
 * Tinted rather than filled, matching Badge: a notice is information, not a
 * call to action, and a saturated block of colour in a settings panel reads as
 * an error even when it is a hint. Every variant is built from existing theme
 * tokens, so it stays in step with light and dark automatically.
 */
const alertVariants = cva(
  'relative flex w-full gap-3 rounded-xl border p-4 text-sm [&>svg]:mt-0.5 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:flex-shrink-0',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted/40 text-foreground [&>svg]:text-muted-foreground',
        info: 'border-primary/20 bg-primary/5 text-foreground [&>svg]:text-primary',
        warning:
          'border-severity-medium/20 bg-severity-medium/5 text-foreground [&>svg]:text-severity-medium',
        destructive:
          'border-destructive/20 bg-destructive/5 text-foreground [&>svg]:text-destructive',
        success: 'border-success/20 bg-success/5 text-foreground [&>svg]:text-success',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn('text-sm font-medium leading-none', className)} {...props} />
  ),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-sm leading-relaxed text-muted-foreground', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
