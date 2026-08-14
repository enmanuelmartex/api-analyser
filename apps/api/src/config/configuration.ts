export default () => ({
  port: parseInt(process.env.PORT, 10) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  // No fallbacks for signing/encryption material: a hardcoded secret in the
  // repository is a publicly known secret. `validateEnv` guarantees these are
  // present and strong before this factory ever runs.
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.REFRESH_TOKEN_SECRET,
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '30d',
  },

  security: {
    encryptionKey: process.env.ENCRYPTION_KEY,
    bcryptRounds: 12,
  },

  // ── AI Provider Configuration ────────────────────────────────────────────────
  // Set AI_PROVIDER to: openai | grok | claude | gemini | ollama | none

  ai: {
    provider: (process.env.AI_PROVIDER || 'openai').toLowerCase(),

    openai: {
      apiKey:           process.env.OPENAI_API_KEY || '',
      model:            process.env.OPENAI_MODEL || 'gpt-4o-mini',
      maxTokens:        parseInt(process.env.OPENAI_MAX_TOKENS, 10) || 2000,
      temperature:      parseFloat(process.env.OPENAI_TEMPERATURE || '0.3'),
      timeoutMs:        parseInt(process.env.OPENAI_TIMEOUT, 10) || 30000,
      maxFindings:      parseInt(process.env.OPENAI_MAX_FINDINGS, 10) || 10,
      executiveSummary: process.env.OPENAI_EXECUTIVE_SUMMARY !== 'false',
      analyzeCritical:  process.env.OPENAI_ANALYZE_CRITICAL !== 'false',
      analyzeHigh:      process.env.OPENAI_ANALYZE_HIGH !== 'false',
      analyzeMedium:    process.env.OPENAI_ANALYZE_MEDIUM === 'true',
      analyzeLow:       process.env.OPENAI_ANALYZE_LOW === 'true',
    },

    grok: {
      apiKey:           process.env.GROQ_API_KEY || '',
      model:            process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      maxTokens:        parseInt(process.env.GROQ_MAX_TOKENS, 10) || 2000,
      temperature:      parseFloat(process.env.GROQ_TEMPERATURE || '0.3'),
      timeoutMs:        parseInt(process.env.GROQ_TIMEOUT, 10) || 30000,
      maxFindings:      parseInt(process.env.GROQ_MAX_FINDINGS, 10) || 10,
      executiveSummary: process.env.GROQ_EXECUTIVE_SUMMARY !== 'false',
      analyzeCritical:  process.env.GROQ_ANALYZE_CRITICAL !== 'false',
      analyzeHigh:      process.env.GROQ_ANALYZE_HIGH !== 'false',
      analyzeMedium:    process.env.GROQ_ANALYZE_MEDIUM === 'true',
      analyzeLow:       process.env.GROQ_ANALYZE_LOW === 'true',
    },

    claude: {
      apiKey:           process.env.CLAUDE_API_KEY || '',
      model:            process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
      maxTokens:        parseInt(process.env.CLAUDE_MAX_TOKENS, 10) || 2000,
      temperature:      parseFloat(process.env.CLAUDE_TEMPERATURE || '0.3'),
      timeoutMs:        parseInt(process.env.CLAUDE_TIMEOUT, 10) || 30000,
      maxFindings:      parseInt(process.env.CLAUDE_MAX_FINDINGS, 10) || 10,
      executiveSummary: process.env.CLAUDE_EXECUTIVE_SUMMARY !== 'false',
      analyzeCritical:  process.env.CLAUDE_ANALYZE_CRITICAL !== 'false',
      analyzeHigh:      process.env.CLAUDE_ANALYZE_HIGH !== 'false',
      analyzeMedium:    process.env.CLAUDE_ANALYZE_MEDIUM === 'true',
      analyzeLow:       process.env.CLAUDE_ANALYZE_LOW === 'true',
    },

    gemini: {
      apiKey:           process.env.GEMINI_API_KEY || '',
      model:            process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      maxTokens:        parseInt(process.env.GEMINI_MAX_TOKENS, 10) || 2000,
      temperature:      parseFloat(process.env.GEMINI_TEMPERATURE || '0.3'),
      timeoutMs:        parseInt(process.env.GEMINI_TIMEOUT, 10) || 30000,
      maxFindings:      parseInt(process.env.GEMINI_MAX_FINDINGS, 10) || 10,
      executiveSummary: process.env.GEMINI_EXECUTIVE_SUMMARY !== 'false',
      analyzeCritical:  process.env.GEMINI_ANALYZE_CRITICAL !== 'false',
      analyzeHigh:      process.env.GEMINI_ANALYZE_HIGH !== 'false',
      analyzeMedium:    process.env.GEMINI_ANALYZE_MEDIUM === 'true',
      analyzeLow:       process.env.GEMINI_ANALYZE_LOW === 'true',
    },

    ollama: {
      baseUrl:          process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      model:            process.env.OLLAMA_MODEL || 'llama3',
      maxTokens:        parseInt(process.env.OLLAMA_MAX_TOKENS, 10) || 2000,
      temperature:      parseFloat(process.env.OLLAMA_TEMPERATURE || '0.3'),
      timeoutMs:        parseInt(process.env.OLLAMA_TIMEOUT, 10) || 60000,
      maxFindings:      parseInt(process.env.OLLAMA_MAX_FINDINGS, 10) || 5,
      executiveSummary: process.env.OLLAMA_EXECUTIVE_SUMMARY !== 'false',
      analyzeCritical:  process.env.OLLAMA_ANALYZE_CRITICAL !== 'false',
      analyzeHigh:      process.env.OLLAMA_ANALYZE_HIGH !== 'false',
      analyzeMedium:    process.env.OLLAMA_ANALYZE_MEDIUM === 'true',
      analyzeLow:       process.env.OLLAMA_ANALYZE_LOW === 'true',
    },
  },

  scanner: {
    maxConcurrentScans:      parseInt(process.env.MAX_CONCURRENT_SCANS, 10) || 3,
    scanTimeoutMs:           parseInt(process.env.SCAN_TIMEOUT_MS, 10) || 300000,
    maxRequestsPerEndpoint:  parseInt(process.env.MAX_REQUESTS_PER_ENDPOINT, 10) || 10,
    rateLimitTestRequests:   parseInt(process.env.RATE_LIMIT_TEST_REQUESTS, 10) || 25,
    requestDelayMs:          parseInt(process.env.REQUEST_DELAY_MS, 10) || 100,
  },

  reports: {
    /** Storage root for binary report artifacts. See ReportStorageService. */
    dir: process.env.REPORTS_DIR || './storage/reports',
  },

  /**
   * Outbound transactional email, via Resend.
   *
   * Entirely optional: with no `RESEND_API_KEY` the mailer reports itself
   * unconfigured, every send is recorded as SKIPPED with a reason, and nothing
   * else changes. A self-hosted install that never sets this still gets its
   * reports and its in-app notifications — email is an addition, not a
   * dependency.
   */
  email: {
    /** Never logged. See EmailService, which redacts it from every message. */
    apiKey: process.env.RESEND_API_KEY || '',
    /**
     * Must be an address on a domain verified in Resend. The `onboarding@`
     * default is Resend's own sandbox sender, which only delivers to the
     * account owner — usable for a first run, wrong for production.
     */
    fromEmail: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    fromName: process.env.RESEND_FROM_NAME || 'API Analyzer',
    /**
     * Base URL used to build links in emails.
     *
     * Falls back to FRONTEND_URL, which every install already sets for CORS, so
     * a working deployment does not need a second variable saying the same
     * thing. Set APP_URL only when the address in an email should differ from
     * the CORS origin — behind a proxy, say.
     */
    appUrl: process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000',
    /**
     * Largest PDF attached to an email, in bytes.
     *
     * Resend's own limit is 40 MB across the whole message, and base64 encoding
     * inflates an attachment by about a third. 8 MB of PDF is a comfortable
     * default that keeps the encoded message far below the ceiling; anything
     * larger is linked to instead of attached, which the email says plainly.
     */
    maxAttachmentBytes: parseInt(process.env.EMAIL_MAX_ATTACHMENT_BYTES, 10) || 8 * 1024 * 1024,
  },
});
