'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import dynamic from 'next/dynamic';
import { useState } from 'react';

/**
 * The devtools panel used to be a static import guarded by a `NODE_ENV` check.
 * The check removed the JSX from production builds but not the import, so the
 * whole devtools package stayed in the module graph of the root layout — the one
 * chunk every route pays for. Building the component behind the environment
 * check lets the bundler drop the `import()` entirely when it is not development.
 */
const ReactQueryDevtools: React.ComponentType<{ initialIsOpen?: boolean }> =
  process.env.NODE_ENV === 'development'
    ? dynamic(() => import('@tanstack/react-query-devtools').then((m) => m.ReactQueryDevtools), {
        ssr: false,
      })
    : () => null;

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        {children}
        {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
