'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  Bug,
  ChevronRight,
  FileText,
  Folder,
  LayoutDashboard,
  Plus,
  Search,
  Settings,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';

/**
 * The product's dashboard, redrawn.
 *
 * Not a screenshot: the stage renders it at 1600 × 900 and then rotates it in
 * 3D, so a raster would blur along the axis it is foreshortened on and would go
 * stale the first time the app's chrome moved. This is markup, and it mirrors
 * the real screen — the same seven sidebar entries as `nav-data.ts`, the same
 * four metric cards and three analytics charts as the dashboard route, the same
 * severity ramp.
 *
 * The numbers are illustrative and deliberately unremarkable: a demo dashboard
 * showing a perfect score would be a claim about what the scanner finds.
 */

/** The seven entries of `NAV_MAIN` in the product's `nav-data.ts`, in order. */
const NAV: readonly {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  badge?: string;
}[] = [
  { icon: LayoutDashboard, label: 'Dashboard', active: true },
  { icon: Folder, label: 'Projects' },
  { icon: Activity, label: 'Scans' },
  { icon: Bug, label: 'Issues', badge: '12' },
  { icon: FileText, label: 'Reports' },
  { icon: ShieldCheck, label: 'Security Checks' },
  { icon: Settings, label: 'Settings' },
];

const METRICS: readonly {
  label: string;
  value: string;
  suffix?: string;
  icon: LucideIcon;
  note: string;
  alarm?: boolean;
}[] = [
  { label: 'Security Score', value: '74', suffix: '/100', icon: Shield, note: 'Average across all scans' },
  { label: 'Critical Findings', value: '3', icon: AlertTriangle, note: 'Require immediate attention', alarm: true },
  { label: 'Projects', value: '6', icon: Folder, note: 'Active API projects' },
  { label: 'Scans', value: '28', icon: Activity, note: 'Completed security scans' },
];

const RECENT = [
  {
    project: 'Payments API',
    target: 'api.payments.internal',
    score: 68,
    critical: 2,
    high: 5,
    status: 'Completed',
  },
  {
    project: 'Identity Service',
    target: 'auth.example.com',
    score: 81,
    critical: 0,
    high: 3,
    status: 'Completed',
  },
  {
    project: 'Partner Gateway',
    target: 'gw.partners.example',
    score: 59,
    critical: 1,
    high: 8,
    status: 'Running',
  },
] as const;

export function DashboardMockup() {
  const container = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.25, delayChildren: 0.4 } },
  };

  const panel = {
    hidden: { opacity: 0, x: 80, y: -60 },
    visible: {
      opacity: 1,
      x: 0,
      y: 0,
      transition: { duration: 1.1, ease: [0.22, 1, 0.36, 1] as const },
    },
  };

  return (
    <motion.div
      aria-hidden="true"
      className="flex h-full w-full overflow-hidden bg-brand-canvas"
      variants={container}
      initial="hidden"
      animate="visible"
    >
      {/* Sidebar */}
      <motion.aside
        className="flex h-full w-[260px] shrink-0 flex-col border-r border-zinc-800/70 bg-zinc-900/40"
        variants={panel}
      >
        <div className="flex h-14 items-center border-b border-zinc-800/60 px-4">
          <BrandLogo type="horizontal" size={30} />
        </div>

        <div className="p-3">
          <div className="flex items-center gap-2 rounded-md bg-zinc-800/50 px-2.5 py-2 text-xs text-zinc-500">
            <Search className="h-3.5 w-3.5" />
            <span>Search…</span>
            <span className="ml-auto rounded bg-zinc-700/50 px-1.5 py-0.5 text-[10px]">⌘K</span>
          </div>
        </div>

        <nav className="space-y-0.5 px-3">
          {NAV.map((item) => (
            <div
              key={item.label}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] ${
                item.active ? 'bg-zinc-800 text-white' : 'text-zinc-400'
              }`}
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {item.badge && (
                <span className="rounded-full bg-severity-critical/15 px-1.5 py-0.5 text-[10px] font-medium text-severity-critical">
                  {item.badge}
                </span>
              )}
            </div>
          ))}
        </nav>

        <div className="mt-6 px-3">
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
            Recent projects
          </p>
          <div className="mt-1 space-y-0.5">
            {['Payments API', 'Identity Service', 'Partner Gateway'].map((name) => (
              <div key={name} className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-zinc-500">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-cyan/70" />
                {name}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-auto border-t border-zinc-800/60 p-3">
          <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
            <span className="brand-gradient flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold text-white">
              EM
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-xs text-zinc-200">Security Analyst</p>
              <p className="truncate text-[10px] text-zinc-500">analyst@example.com</p>
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Main column */}
      <motion.div className="flex h-full flex-1 flex-col overflow-hidden" variants={panel}>
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800/60 px-6">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span>Workspace</span>
            <ChevronRight className="h-3 w-3" />
            <span className="text-zinc-300">Security Dashboard</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-500">
              Last scan 12 min ago
            </span>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-hidden p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-[22px] font-semibold text-white">Security Dashboard</h1>
              <p className="mt-1 text-[13px] text-zinc-500">
                Monitor your API security posture across all projects
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-900">
              <Plus className="h-3.5 w-3.5" />
              New Project
            </span>
          </div>

          {/* Metric cards */}
          <div className="grid grid-cols-4 gap-4">
            {METRICS.map((metric) => (
              <div key={metric.label} className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4">
                <div className="flex items-center justify-between text-zinc-500">
                  <span className="text-[11px] uppercase tracking-wide">{metric.label}</span>
                  <metric.icon className="h-4 w-4" />
                </div>
                <p className="mt-3 flex items-baseline gap-1">
                  <span
                    className={`text-3xl font-semibold ${metric.alarm ? 'text-severity-critical' : 'text-white'}`}
                  >
                    {metric.value}
                  </span>
                  {metric.suffix && <span className="text-sm text-zinc-600">{metric.suffix}</span>}
                </p>
                <p className="mt-1.5 text-[11px] text-zinc-600">{metric.note}</p>
              </div>
            ))}
          </div>

          {/* Analytics */}
          <div className="grid grid-cols-3 gap-4">
            <ChartCard title="Security score" subtitle="Last 12 months">
              <ScoreTrend />
            </ChartCard>
            <ChartCard title="Findings by Severity" subtitle="Last 8 weeks">
              <SeverityRadial />
            </ChartCard>
            <ChartCard title="Open issues by OWASP category" subtitle="API1 – API10">
              <OwaspRadar />
            </ChartCard>
          </div>

          {/* Recent scans */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30">
            <div className="flex items-center justify-between border-b border-zinc-800/60 px-4 py-3">
              <h2 className="text-[13px] font-medium text-zinc-200">Recent scans</h2>
              <span className="text-[11px] text-zinc-600">View all</span>
            </div>
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-zinc-600">
                  <th className="px-4 py-2 font-medium">Project</th>
                  <th className="px-4 py-2 font-medium">Target</th>
                  <th className="px-4 py-2 font-medium">Score</th>
                  <th className="px-4 py-2 font-medium">Findings</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {RECENT.map((row) => (
                  <tr key={row.project} className="border-t border-zinc-800/40">
                    <td className="px-4 py-2.5 text-zinc-200">{row.project}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-500">{row.target}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          row.score >= 75
                            ? 'bg-severity-low/10 text-severity-low'
                            : row.score >= 65
                              ? 'bg-severity-medium/10 text-severity-medium'
                              : 'bg-severity-critical/10 text-severity-critical'
                        }`}
                      >
                        {row.score}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="mr-2 text-severity-critical">{row.critical} critical</span>
                      <span className="text-severity-high">{row.high} high</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-zinc-400">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            row.status === 'Running' ? 'bg-brand-cyan' : 'bg-emerald-500'
                          }`}
                        />
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4">
      <p className="text-[13px] font-medium text-zinc-200">{title}</p>
      <p className="mt-0.5 text-[11px] text-zinc-600">{subtitle}</p>
      <div className="mt-4 h-[130px]">{children}</div>
    </div>
  );
}

/** A score line that recovers over the year — drawn, not plotted. */
function ScoreTrend() {
  const points = [41, 48, 46, 55, 59, 57, 64, 62, 69, 71, 70, 74];
  const width = 260;
  const height = 130;
  const step = width / (points.length - 1);
  const y = (value: number) => height - (value / 100) * height * 0.92 - 6;
  const line = points.map((value, i) => `${i === 0 ? 'M' : 'L'}${i * step},${y(value)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full">
      <defs>
        <linearGradient id="score-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2E8BF5" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#2E8BF5" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="score-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#6D4BFF" />
          <stop offset="50%" stopColor="#2E8BF5" />
          <stop offset="100%" stopColor="#1FC2E8" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((fraction) => (
        <line
          key={fraction}
          x1="0"
          x2={width}
          y1={height * fraction}
          y2={height * fraction}
          stroke="#27272a"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path d={area} fill="url(#score-fill)" />
      <path
        d={line}
        fill="none"
        stroke="url(#score-line)"
        strokeWidth="2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Findings by severity — the product's radial chart, redrawn.
 *
 * The app plots this as a Recharts `RadialBarChart`: one concentric band per
 * severity, Critical outermost, each arc's sweep proportional to that
 * severity's share of the largest one, over a circular polar grid. This used to
 * be a stack of vertical bars here, which was a different chart entirely and
 * made the hero misrepresent the screen it is a picture of.
 *
 * Hand-drawn arcs rather than the real library: the stage renders this inside a
 * plane rotated on three axes, and pulling Recharts onto the landing for one
 * decorative chart would cost more JavaScript than the rest of the page.
 */
const SEVERITY_TOTALS = [
  { name: 'Critical', value: 3, color: '#ef4444' },
  { name: 'High', value: 18, color: '#f97316' },
  { name: 'Medium', value: 42, color: '#f59e0b' },
  { name: 'Low', value: 11, color: '#38bdf8' },
  { name: 'Informational', value: 6, color: '#918f9a' },
] as const;

function SeverityRadial() {
  const size = 150;
  const center = size / 2;
  const outerRadius = 68;
  const innerRadius = 20;
  const gap = 3;
  const band = (outerRadius - innerRadius) / SEVERITY_TOTALS.length;
  const max = Math.max(...SEVERITY_TOTALS.map((s) => s.value));

  /** Arc path for one band, swept clockwise from twelve o'clock. */
  const arc = (radius: number, fraction: number) => {
    // A full circle cannot be expressed as a single arc — its start and end
    // points coincide — so it is drawn as two half sweeps.
    const angle = Math.min(fraction, 0.9999) * 360;
    const point = (deg: number) => {
      const rad = ((deg - 90) * Math.PI) / 180;
      return [center + Math.cos(rad) * radius, center + Math.sin(rad) * radius];
    };
    const [x0, y0] = point(0);
    const [x1, y1] = point(angle);
    const largeArc = angle > 180 ? 1 : 0;
    return `M${x0},${y0} A${radius},${radius} 0 ${largeArc} 1 ${x1},${y1}`;
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-[104px]">
        {/* Polar grid — `gridType="circle"` in the real chart. */}
        {[0.4, 0.7, 1].map((scale) => (
          <circle
            key={scale}
            cx={center}
            cy={center}
            r={outerRadius * scale}
            fill="none"
            stroke="#27272a"
            strokeWidth="1"
          />
        ))}

        {SEVERITY_TOTALS.map((severity, index) => {
          const radius = outerRadius - band * index - band / 2;
          const thickness = band - gap;
          return (
            <g key={severity.name}>
              <path
                d={arc(radius, 1)}
                fill="none"
                stroke="#1c1c1f"
                strokeWidth={thickness}
                strokeLinecap="round"
              />
              {severity.value > 0 && (
                <path
                  d={arc(radius, severity.value / max)}
                  fill="none"
                  stroke={severity.color}
                  strokeWidth={thickness}
                  strokeLinecap="round"
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* The totals list the real card carries under the chart. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {SEVERITY_TOTALS.map((severity) => (
          <div key={severity.name} className="flex items-center justify-between gap-2 text-[10px]">
            <span className="flex min-w-0 items-center gap-1.5 text-zinc-500">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: severity.color }} />
              <span className="truncate">{severity.name}</span>
            </span>
            <span className="shrink-0 font-medium tabular-nums text-zinc-300">{severity.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Ten axes, one per OWASP API category — the shape the real radar draws. */
function OwaspRadar() {
  const size = 130;
  const center = size / 2;
  const radius = center - 10;
  const values = [0.8, 0.55, 0.7, 0.35, 0.5, 0.3, 0.45, 0.85, 0.4, 0.25];

  const point = (index: number, scale: number) => {
    const angle = (Math.PI * 2 * index) / values.length - Math.PI / 2;
    return [center + Math.cos(angle) * radius * scale, center + Math.sin(angle) * radius * scale];
  };

  const ring = (scale: number) =>
    values.map((_, i) => point(i, scale).join(',')).join(' ');

  const shape = values.map((value, i) => point(i, value).join(',')).join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-full">
      {[0.25, 0.5, 0.75, 1].map((scale) => (
        <polygon key={scale} points={ring(scale)} fill="none" stroke="#27272a" strokeWidth="1" />
      ))}
      {values.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={center} y1={center} x2={x} y2={y} stroke="#27272a" strokeWidth="1" />;
      })}
      <polygon points={shape} fill="#6D4BFF" fillOpacity="0.25" stroke="#8B6BFF" strokeWidth="1.5" />
    </svg>
  );
}
