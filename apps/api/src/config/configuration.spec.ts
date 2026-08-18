import configuration from './configuration';

/**
 * Reads `docs.enabled` with SWAGGER_ENABLED set to `value`, then restores the
 * variable. The factory reads process.env at call time, so each case has to set
 * it before calling.
 */
function docsEnabledWith(value: string | undefined): boolean {
  const previous = process.env.SWAGGER_ENABLED;

  if (value === undefined) delete process.env.SWAGGER_ENABLED;
  else process.env.SWAGGER_ENABLED = value;

  try {
    return configuration().docs.enabled;
  } finally {
    if (previous === undefined) delete process.env.SWAGGER_ENABLED;
    else process.env.SWAGGER_ENABLED = previous;
  }
}

describe('configuration → docs.enabled', () => {
  it('is on when SWAGGER_ENABLED is unset', () => {
    expect(docsEnabledWith(undefined)).toBe(true);
  });

  it('is on for an explicit true', () => {
    expect(docsEnabledWith('true')).toBe(true);
  });

  it('is off only for an explicit false', () => {
    expect(docsEnabledWith('false')).toBe(false);
    expect(docsEnabledWith('FALSE')).toBe(false);
  });

  // Compose writes an empty string for an unset variable
  // (`SWAGGER_ENABLED: ${SWAGGER_ENABLED:-true}` with the key present but blank
  // in .env), which must mean "default", not "off".
  it('treats an empty value as unset', () => {
    expect(docsEnabledWith('')).toBe(true);
  });

  it('does not follow NODE_ENV', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      expect(docsEnabledWith(undefined)).toBe(true);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
