'use client';

import Link from 'next/link';
import { IconExternalLink } from '@tabler/icons-react';
import { formatBytes, formatDate } from '@/lib/utils';
import type { Report } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Technical identity of the report, as a sidebar description list.
 *
 * The header above carries only what identifies the document at a glance —
 * project, type, format, date. Everything a reader would go looking for
 * deliberately (file size, revision, which generator built it, the assessment
 * id) lives here, so the two are complementary rather than a duplicate row of
 * the same four facts in two type sizes.
 */
export function ReportMetadata({ report }: { report: Report }) {
  const project = report.assessment?.project;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Report metadata</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border text-sm">
          <Row label="Project">
            {project ? (
              <Link
                href={`/projects/${project.id}`}
                className="inline-flex max-w-full items-center gap-1 truncate hover:underline"
              >
                <span className="truncate">{project.name}</span>
                <IconExternalLink className="size-3 shrink-0 text-muted-foreground" />
              </Link>
            ) : (
              '—'
            )}
          </Row>

          <Row label="Assessment">
            <Link
              href={`/assessments/${report.assessmentId}`}
              className="inline-flex max-w-full items-center gap-1 truncate font-mono text-xs hover:underline"
              title={report.assessmentId}
            >
              <span className="truncate">{report.assessmentId.slice(0, 10)}…</span>
              <IconExternalLink className="size-3 shrink-0 text-muted-foreground" />
            </Link>
          </Row>

          <Row label="Type">
            <span className="capitalize">{report.type.toLowerCase()}</span>
          </Row>

          <Row label="Format">
            <Badge
              variant="outline"
              className="font-mono text-[10px] font-bold uppercase tracking-wider"
            >
              {report.format}
            </Badge>
          </Row>

          <Row label="Generated">{formatDate(report.generatedAt)}</Row>

          <Row label="File size">
            <span className="tabular-nums">{formatBytes(report.fileSize)}</span>
          </Row>

          <Row label="Version">
            <span className="tabular-nums">v{report.version}</span>
          </Row>

          {report.generatorVersion && (
            <Row label="Generator">
              <span className="font-mono text-xs">{report.generatorVersion}</span>
            </Row>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm text-foreground">{children}</dd>
    </div>
  );
}
