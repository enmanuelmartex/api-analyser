// =============================================================================
// Plugin Manifest — stable contract between plugins and the Core
// =============================================================================

export enum PluginCategory {
  AUTHENTICATION  = 'Authentication',
  AUTHORIZATION   = 'Authorization',
  HEADERS         = 'Headers',
  INJECTION       = 'Injection',
  API_DESIGN      = 'API Design',
  PERFORMANCE     = 'Performance',
  INFRASTRUCTURE  = 'Infrastructure',
  COMPLIANCE      = 'Compliance',
  AI              = 'AI',
  CLOUD           = 'Cloud',
  GRAPHQL         = 'GraphQL',
  GRPC            = 'gRPC',
  SOAP            = 'SOAP',
}

export type ApiType = 'REST' | 'GraphQL' | 'gRPC' | 'SOAP';

export type PluginPermission =
  | 'http:read'        // send HTTP requests to target
  | 'http:write'       // send mutating HTTP requests (POST/PUT/PATCH/DELETE)
  | 'findings:write'   // emit findings
  | 'ai:read'          // call AI service
  | 'db:read'          // read from DB (future)
  | 'cache:read'       // read from cache (future)
  | 'cache:write';     // write to cache (future)

export interface PluginConfigField {
  key: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect';
  default?: any;
  options?: Array<{ value: string | number; label: string }>;
  min?: number;
  max?: number;
  required?: boolean;
}

export interface PluginManifest {
  /** Stable, lowercase-kebab ID. Never change after publish. */
  id: string;
  name: string;
  version: string;
  description: string;
  longDescription?: string;
  author: string;
  license: string;
  category: PluginCategory;
  /** OWASP API Security Top 10 categories addressed, e.g. ["API1:2023"] */
  owaspMappings: string[];
  cweIds?: string[];
  tags: string[];
  supportedApiTypes: ApiType[];
  permissions: PluginPermission[];
  /** UI-renderable config fields exposed by this plugin */
  configFields?: PluginConfigField[];
  /** Default values for configFields */
  defaultConfig?: Record<string, any>;
  documentationUrl?: string;
  changelog?: string;
  /** Minimum API Analyser core version required */
  minimumCoreVersion: string;
  isBuiltin: boolean;

  /**
   * Namespace every ruleId of this plugin must start with, e.g. `headers`.
   *
   * Separate from `id` because a namespace reads better in a fingerprint than a
   * plugin slug does (`headers.missing-hsts`, not `security-headers.missing-hsts`).
   */
  ruleNamespace: string;

  /**
   * Every ruleId this plugin can emit, declared up front.
   *
   * Rule ids are part of the issue fingerprint, so they are API-stable: changing
   * one splits an existing issue into a new one. Declaring them here lets the
   * registry reject empty, unnamespaced or colliding ids at boot, and lets the
   * persistence layer reject a finding whose ruleId was never declared.
   */
  ruleIds: string[];
}
