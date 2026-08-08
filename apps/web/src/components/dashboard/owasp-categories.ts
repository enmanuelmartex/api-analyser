/**
 * The OWASP API Security Top 10 (2023) category list.
 *
 * Extracted from `dashboard-charts.tsx` so that consumers which only need the
 * category metadata — the dashboard page aggregates coverage before deciding
 * whether a chart is worth rendering — do not pull Recharts into their bundle.
 * Importing any binding from `dashboard-charts` drags the whole chart module
 * with it, which is ~350 KB of JavaScript for a ten-element array.
 */
export const OWASP_CATEGORIES = [
  { id: 'API1:2023', label: 'API1', fullName: 'Broken Object Level Authorization' },
  { id: 'API2:2023', label: 'API2', fullName: 'Broken Authentication' },
  { id: 'API3:2023', label: 'API3', fullName: 'Broken Object Property Level Authorization' },
  { id: 'API4:2023', label: 'API4', fullName: 'Unrestricted Resource Consumption' },
  { id: 'API5:2023', label: 'API5', fullName: 'Broken Function Level Authorization' },
  { id: 'API6:2023', label: 'API6', fullName: 'Unrestricted Access to Sensitive Business Flows' },
  { id: 'API7:2023', label: 'API7', fullName: 'Server Side Request Forgery' },
  { id: 'API8:2023', label: 'API8', fullName: 'Security Misconfiguration' },
  { id: 'API9:2023', label: 'API9', fullName: 'Improper Inventory Management' },
  { id: 'API10:2023', label: 'API10', fullName: 'Unsafe Consumption of APIs' },
] as const;
