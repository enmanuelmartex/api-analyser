import Link from 'next/link';
import { IconArrowRight, IconChevronRight, IconBolt, IconPlus } from '@tabler/icons-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/security/finding-status-badge';
import { ScoreCell } from '@/components/security/score-display';
import { formatDuration, formatRelative } from '@/lib/utils';
import type { Assessment } from '@/types';

export function RecentAssessmentsTable({ assessments, canWrite = true }: { assessments: Assessment[]; canWrite?: boolean }) {
  return <Card className="shadow-none">
    <CardHeader className="flex-row items-start justify-between space-y-0">
      <div><CardTitle>Recent Assessments</CardTitle><CardDescription className="mt-1">Latest API security scans and results</CardDescription></div>
      <Button asChild variant="ghost" size="sm"><Link href="/assessments">View all <IconArrowRight className="h-4 w-4" /></Link></Button>
    </CardHeader>
    {!assessments.length ? <CardContent><EmptyState icon={IconBolt} title="No assessments yet" description="Create a project and run your first security scan." action={canWrite ? <Button asChild variant="outline" size="sm"><Link href="/projects/new"><IconPlus className="h-4 w-4" />Get started</Link></Button> : undefined} /></CardContent> :
    <div className="overflow-x-auto"><Table><TableHeader className="bg-card"><TableRow><TableHead>Assessment</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Score</TableHead><TableHead className="hidden text-right md:table-cell">Critical + High</TableHead><TableHead className="hidden lg:table-cell">Started</TableHead><TableHead className="hidden lg:table-cell">Duration</TableHead><TableHead className="w-10"><span className="sr-only">Open</span></TableHead></TableRow></TableHeader><TableBody>{assessments.map((assessment) => <TableRow key={assessment.id} className="group"><TableCell><Link href={`/assessments/${assessment.id}`} className="block min-w-48"><span className="block font-medium">{assessment.project?.name ?? 'Assessment'}</span><span className="block max-w-72 truncate text-xs text-muted-foreground">{assessment.project?.baseUrl}</span></Link></TableCell><TableCell><StatusBadge status={assessment.status} /></TableCell><TableCell className="text-right font-medium tabular-nums"><ScoreCell score={assessment.summary?.securityScore ?? null} status={(assessment.summary?.scoreStatus ?? 'UNAVAILABLE') as any} /></TableCell><TableCell className="hidden text-right tabular-nums md:table-cell">{assessment.findingCounts ? assessment.findingCounts.critical + assessment.findingCounts.high : '—'}</TableCell><TableCell className="hidden text-muted-foreground lg:table-cell">{formatRelative(assessment.createdAt)}</TableCell><TableCell className="hidden text-muted-foreground tabular-nums lg:table-cell">{assessment.duration ? formatDuration(assessment.duration) : '—'}</TableCell><TableCell><Button asChild variant="ghost" size="icon"><Link href={`/assessments/${assessment.id}`} aria-label={`Open ${assessment.project?.name ?? 'assessment'}`}><IconChevronRight className="h-4 w-4" /></Link></Button></TableCell></TableRow>)}</TableBody></Table></div>}
  </Card>;
}
