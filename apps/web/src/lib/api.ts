import axios, { AxiosInstance } from 'axios';
import type {
  Report,
  ReportFormat,
  ReportFormatAvailability,
  ReportStats,
  ReportType,
} from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: API_URL,
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  client.interceptors.request.use((config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('iasa_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('iasa_token');
          localStorage.removeItem('iasa_user');
          window.location.href = '/login';
        }
      }
      return Promise.reject(error);
    },
  );

  return client;
}

export const api = createApiClient();

// Auth
export const authApi = {
  // Legacy email/password login (kept for existing accounts with User.password)
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data).then((r) => r.data),
  // Legacy self-registration
  register: (data: { name: string; email: string; password: string }) =>
    api.post('/auth/register', data).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
  // Exchange a Better Auth session token for a JWT used by all domain routes
  exchangeSession: (sessionToken: string) =>
    api.post('/auth/exchange-session', { token: sessionToken }).then((r) => r.data),
};

// Projects
export const projectsApi = {
  list: () => api.get('/projects').then((r) => r.data),
  get: (id: string) => api.get(`/projects/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/projects', data).then((r) => r.data),
  createDraft: (data: any) => api.post('/projects/drafts', data).then((r) => r.data),
  saveDraft: (id: string, data: any) => api.put(`/projects/${id}/draft`, data).then((r) => r.data),
  finalize: (id: string) => api.post(`/projects/${id}/finalize`).then((r) => r.data),
  update: (id: string, data: any) => api.put(`/projects/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/projects/${id}`).then((r) => r.data),
  importFromUrl: (id: string, url: string) =>
    api.post(`/projects/${id}/spec/url`, { url }).then((r) => r.data),
  importFromContent: (id: string, spec: object) =>
    api.post(`/projects/${id}/spec/upload`, { spec }).then((r) => r.data),
  saveAuth: (id: string, data: any) => api.post(`/projects/${id}/auth`, data).then((r) => r.data),
};

// Assessments
export const assessmentsApi = {
  list: (projectId?: string) =>
    api.get('/assessments', { params: projectId ? { projectId } : {} }).then((r) => r.data),
  // Server-side paginated assessments for one project, newest first.
  listByProject: (projectId: string, page = 1, pageSize = 5) =>
    api
      .get(`/assessments/projects/${projectId}`, { params: { page, pageSize } })
      .then((r) => r.data),
  get: (id: string) => api.get(`/assessments/${id}`).then((r) => r.data),
  run: (projectId: string, config?: {
    executionMode?: 'all' | 'profile' | 'manual';
    scanProfileId?: string;
    manualPlugins?: string[];
    enableAiAnalysis?: boolean;
    maxRequestsPerEndpoint?: number;
    requestDelayMs?: number;
    timeoutMs?: number;
  }) =>
    api.post(`/assessments/projects/${projectId}/run`, config).then((r) => r.data),
  cancel: (id: string) => api.delete(`/assessments/${id}`).then((r) => r.data),
  dashboard: () => api.get('/assessments/dashboard').then((r) => r.data),
  streamProgress: (id: string, token: string) =>
    new EventSource(`${API_URL}/assessments/${id}/progress?token=${token}`),
};

// Findings
/**
 * Persistent vulnerabilities.
 *
 * Replaces `findingsApi`, which returned one row per detection, so the same
 * vulnerability appeared once per scan. An issue appears exactly once; the
 * detections behind it are its occurrences.
 */
export const issuesApi = {
  list: (filters?: {
    projectId?: string;
    status?: string;
    severity?: string;
    owaspCategory?: string;
    pluginId?: string;
    ruleId?: string;
    assigneeId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) => api.get('/issues', { params: filters }).then((r) => r.data),

  get: (id: string) => api.get(`/issues/${id}`).then((r) => r.data),

  stats: (projectId?: string) =>
    api.get('/issues/stats', { params: projectId ? { projectId } : {} }).then((r) => r.data),

  updateStatus: (
    id: string,
    payload: { status: string; reason?: string; acceptedRiskUntil?: string },
  ) => api.patch(`/issues/${id}/status`, payload).then((r) => r.data),

  assign: (id: string, assigneeId: string | null) =>
    api.patch(`/issues/${id}/assignee`, { assigneeId }).then((r) => r.data),

  /** Detections produced by one scan — immutable history, not current state. */
  occurrencesByAssessment: (assessmentId: string) =>
    api.get(`/issues/occurrences/assessment/${assessmentId}`).then((r) => r.data),
};

// Plugins
export const pluginsApi = {
  list: () => api.get('/plugins').then((r) => r.data),
  get: (id: string) => api.get(`/plugins/${id}`).then((r) => r.data),
  toggle: (id: string, isEnabled: boolean) =>
    api.put(`/plugins/${id}/toggle`, { isEnabled }).then((r) => r.data),
  saveConfig: (id: string, config: Record<string, any>) =>
    api.put(`/plugins/${id}/config`, config).then((r) => r.data),
  getExecutions: (id: string) => api.get(`/plugins/${id}/executions`).then((r) => r.data),
  getIssues: (id: string) => api.get(`/plugins/${id}/issues`).then((r) => r.data),
  run: (id: string, projectId: string, pluginConfig?: Record<string, any>) =>
    api.post(`/plugins/${id}/run`, { projectId, pluginConfig }).then((r) => r.data),
  categories: () => api.get('/plugins/categories').then((r) => r.data),
};

// Scan Profiles
export const profilesApi = {
  list: () => api.get('/plugins/profiles').then((r) => r.data),
  get: (id: string) => api.get(`/plugins/profiles/${id}`).then((r) => r.data),
  create: (data: {
    name: string;
    description?: string;
    icon?: string;
    enabledPlugins: string[];
    pluginConfigs?: Record<string, any>;
  }) => api.post('/plugins/profiles', data).then((r) => r.data),
  update: (id: string, data: Partial<{
    name: string;
    description: string;
    icon: string;
    enabledPlugins: string[];
    pluginConfigs: Record<string, any>;
  }>) => api.put(`/plugins/profiles/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/plugins/profiles/${id}`).then((r) => r.data),
};

// AI Provider
export const aiApi = {
  status:              () => api.get('/ai/status').then((r) => r.data),
  getAllConfigs:        () => api.get('/ai/config').then((r) => r.data),
  getProviderConfig:   (provider: string) => api.get(`/ai/config/${provider}`).then((r) => r.data),
  saveProviderConfig:  (provider: string, data: any) => api.put(`/ai/config/${provider}`, data).then((r) => r.data),
  activateProvider:    (provider: string) => api.put(`/ai/config/${provider}/activate`).then((r) => r.data),
  deactivateAll:       () => api.put('/ai/config/deactivate-all').then((r) => r.data),
  testProvider:        (provider: string, data: any) => api.post(`/ai/config/${provider}/test`, data).then((r) => r.data),
  deleteProviderConfig:(provider: string) => api.delete(`/ai/config/${provider}`).then((r) => r.data),
  getEnvStatus:        () => api.get('/ai/config/env-status').then((r) => r.data),
};

// Users (admin)
export const usersApi = {
  list: () => api.get('/users').then((r) => r.data),
  get: (id: string) => api.get(`/users/${id}`).then((r) => r.data),
  create: (data: { name: string; email: string; password: string; role?: string }) =>
    api.post('/users', data).then((r) => r.data),
  update: (id: string, data: { name?: string }) =>
    api.patch(`/users/${id}`, data).then((r) => r.data),
  changeRole: (id: string, role: string) =>
    api.patch(`/users/${id}/role`, { role }).then((r) => r.data),
  setStatus: (id: string, isActive: boolean) =>
    api.patch(`/users/${id}/status`, { isActive }).then((r) => r.data),
  resetPassword: (id: string, newPassword: string) =>
    api.post(`/users/${id}/password-reset`, { newPassword }).then((r) => r.data),
  remove: (id: string) => api.delete(`/users/${id}`).then((r) => r.data),
  auditLogs: (params?: { limit?: number; offset?: number; userId?: string; action?: string; resource?: string }) =>
    api.get('/users/audit-logs', { params }).then((r) => r.data),
  // Invitation system
  invite: (data: { email: string; role?: string }) =>
    api.post('/users/invite', data).then((r) => r.data),
  verifyInvite: (token: string) =>
    api.get('/users/verify-invite', { params: { token } }).then((r) => r.data),
  acceptInvite: (token: string) =>
    api.post('/users/accept-invite', { token }).then((r) => r.data),
};

/**
 * Reports.
 *
 * `generate` and `download` are deliberately separate calls against separate
 * endpoints. They used to be the same one: the "Download" button issued
 * `GET /reports/assessment/:id/generate`, which re-rendered the document AND
 * inserted another Report row, so every download of an existing report created
 * a duplicate. `download` below is read-only — it can never create a record.
 */
export const reportsApi = {
  stats: (): Promise<ReportStats> => api.get('/reports/stats').then((r) => r.data),

  list: (options: { assessmentId?: string; includeHistory?: boolean } = {}): Promise<Report[]> =>
    api
      .get('/reports', {
        params: {
          ...(options.assessmentId ? { assessmentId: options.assessmentId } : {}),
          ...(options.includeHistory ? { includeHistory: 'true' } : {}),
        },
      })
      .then((r) => r.data),

  listByAssessment: (assessmentId: string): Promise<Report[]> =>
    api.get(`/reports/assessment/${assessmentId}`).then((r) => r.data),

  get: (id: string): Promise<Report> => api.get(`/reports/${id}`).then((r) => r.data),

  formats: (assessmentId: string, type: ReportType = 'TECHNICAL'): Promise<ReportFormatAvailability[]> =>
    api.get(`/reports/assessment/${assessmentId}/formats`, { params: { type } }).then((r) => r.data),

  delete: (id: string) => api.delete(`/reports/${id}`).then((r) => r.data),

  /**
   * Creates an artifact — the only call that may add a report.
   *
   * Idempotent on the server: requesting a format that already exists returns
   * the existing report with `created: false`, so a double click cannot produce
   * two rows. Pass `regenerate` for the deliberate "make a new version" action.
   */
  generate: (
    assessmentId: string,
    format: ReportFormat,
    type: ReportType = 'TECHNICAL',
    options: { regenerate?: boolean } = {},
  ): Promise<{ report: Report; created: boolean }> =>
    api
      .post(`/reports/assessment/${assessmentId}/generate`, {
        format,
        type,
        regenerate: options.regenerate === true,
      })
      .then((r) => r.data),

  /**
   * Downloads an artifact that already exists. Never generates anything.
   *
   * The saved file name comes from the server's `Content-Disposition`, so it
   * matches the name stored with the report rather than being re-derived here.
   */
  download: async (reportId: string): Promise<void> => {
    const response = await api.get(`/reports/${reportId}/download`, { responseType: 'blob' });

    const rawContentType = response.headers['content-type'];
    const contentType = typeof rawContentType === 'string' ? rawContentType : undefined;
    const fileName = filenameFromContentDisposition(response.headers['content-disposition']) ?? `iasa-report-${reportId.slice(0, 8)}`;

    const url = URL.createObjectURL(new Blob([response.data], { type: contentType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
};

/** Reads the server-chosen file name, preferring the RFC 5987 `filename*` form. */
export function filenameFromContentDisposition(header: unknown): string | null {
  if (typeof header !== 'string') return null;

  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // Fall through to the plain form.
    }
  }

  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : null;
}

// NOTE: `financeApi` was removed in Phase 0. It called `/finance/summary` and
// `/finance/usage`, which have no backend implementation — the API's finance
// module is an empty directory, so every call 404'd. AI token usage will be
// surfaced under Settings → AI Usage in Phase 8, once usage is actually
// persisted in a queryable form. The Finance* types in `@/types` are kept for
// that work.

/**
 * Scores, posture and comparison.
 *
 * A score is always read together with its status: `UNAVAILABLE` means no
 * score exists (never 0 or 100), `PROVISIONAL` means the scan did not complete
 * every planned check, `FINAL` means it did.
 */
export const scoringApi = {
  assessmentScore: (assessmentId: string) =>
    api.get(`/assessments/${assessmentId}/score`).then((r) => r.data),

  projectPosture: (projectId: string) =>
    api.get(`/projects/${projectId}/posture`).then((r) => r.data),

  compare: (assessmentId: string, baseline?: string) =>
    api
      .get(`/assessments/${assessmentId}/comparison`, { params: baseline ? { baseline } : {} })
      .then((r) => r.data),

  comparisonCandidates: (assessmentId: string) =>
    api.get(`/assessments/${assessmentId}/comparison/candidates`).then((r) => r.data),
};
