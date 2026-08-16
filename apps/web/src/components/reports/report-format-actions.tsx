'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconDownload, IconFilePlus, IconLoader2, IconAlertTriangle } from '@tabler/icons-react';
import { toast } from 'sonner';
import { reportsApi } from '@/lib/api';
import { formatBytes, formatDay } from '@/lib/utils';
import type { ReportFormat, ReportFormatAvailability, ReportType } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const FORMAT_DESCRIPTION: Record<ReportFormat, string> = {
  PDF: 'Print-ready document for sharing',
  HTML: 'Self-contained web page',
  MARKDOWN: 'Plain text for docs and tickets',
  JSON: 'Structured data for tooling',
  SARIF: 'Static analysis interchange for CI',
};

/**
 * Per-format Download / Generate controls.
 *
 * The verb follows what actually exists on the server, never the fact that a
 * format is theoretically supported:
 *
 *   AVAILABLE   → "Download"  — streams the stored artifact, creates nothing
 *   MISSING     → "Generate"  — the only action that may create a report
 *   UNAVAILABLE → "Generate"  — a row from before artifacts were persisted;
 *                               generating fills it in without a new record
 *
 * Labelling a missing format "Download" is what made generation look like a
 * download in the first place, so the two verbs are never interchanged here.
 */
export function ReportFormatActions({
  assessmentId,
  type,
  formats,
  primaryFormat,
}: {
  assessmentId: string;
  type: ReportType;
  formats: ReportFormatAvailability[];
  /** Highlighted as the format currently being viewed. */
  primaryFormat?: ReportFormat;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<ReportFormat | null>(null);

  const download = useMutation({
    mutationFn: async (entry: ReportFormatAvailability) => {
      if (!entry.reportId) throw new Error('missing-report');
      await reportsApi.download(entry.reportId);
    },
    onError: () => toast.error('The existing report could not be downloaded.'),
  });

  const generate = useMutation({
    mutationFn: (format: ReportFormat) => reportsApi.generate(assessmentId, format, type),
    onSuccess: (result, format) => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['reports-stats'] });
      toast.success(
        result.created ? `${format} report generated` : `${format} report was already available`,
      );
    },
    onError: (_error, format) =>
      toast.error(`${format} report generation failed.`, {
        action: { label: 'Retry', onClick: () => run(format, () => generate.mutateAsync(format)) },
      }),
  });

  async function run(format: ReportFormat, action: () => Promise<unknown>) {
    setBusy(format);
    try {
      await action();
    } catch {
      // Surfaced by the mutation's own onError handler.
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Available formats</CardTitle>
        <CardDescription>
          Download an artifact that already exists, or generate one that does not.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {formats.map((entry, index) => {
          const isBusy = busy === entry.format;
          const exists = entry.status === 'AVAILABLE';

          return (
            <div key={entry.format}>
              {index > 0 && <Separator />}
              <div className="flex items-center justify-between gap-4 px-6 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Badge
                    variant={entry.format === primaryFormat ? 'default' : 'outline'}
                    className="w-[74px] justify-center font-mono text-[10px] font-bold uppercase tracking-wider"
                  >
                    {entry.format}
                  </Badge>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">
                      {FORMAT_DESCRIPTION[entry.format]}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {exists
                        ? [
                            entry.fileSize ? formatBytes(entry.fileSize) : null,
                            entry.generatedAt ? `generated ${formatDay(entry.generatedAt)}` : null,
                            entry.version && entry.version > 1 ? `v${entry.version}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : entry.status === 'UNAVAILABLE'
                          ? 'Recorded without a stored file'
                          : 'Not generated'}
                    </p>
                  </div>
                </div>

                {entry.status === 'UNAVAILABLE' && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <IconAlertTriangle
                        className="size-4 shrink-0 text-severity-medium"
                        aria-label="This report has no stored file"
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      This report predates stored artifacts. Generating rebuilds its file without
                      creating a new report.
                    </TooltipContent>
                  </Tooltip>
                )}

                {exists ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-[110px] shrink-0"
                        disabled={isBusy}
                        aria-label={`Download the existing ${entry.format} report`}
                        onClick={() => run(entry.format, () => download.mutateAsync(entry))}
                      >
                        {isBusy ? (
                          <IconLoader2 className="size-3.5 animate-spin" />
                        ) : (
                          <IconDownload className="size-3.5" />
                        )}
                        {isBusy ? 'Preparing…' : 'Download'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Downloads the stored file. No new report is created.</TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-[110px] shrink-0"
                        disabled={isBusy}
                        aria-label={`Generate the ${entry.format} report`}
                        onClick={() => run(entry.format, () => generate.mutateAsync(entry.format))}
                      >
                        {isBusy ? (
                          <IconLoader2 className="size-3.5 animate-spin" />
                        ) : (
                          <IconFilePlus className="size-3.5" />
                        )}
                        {isBusy ? 'Generating…' : 'Generate'}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Builds this format from the scan’s stored results.</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
