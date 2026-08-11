import {
  REDACTED,
  isSensitiveHeader,
  isSensitiveParam,
  redactHeaders,
  redactHttpMessage,
  redactObject,
  redactUrl,
} from './redact.util';

describe('isSensitiveHeader', () => {
  it.each([
    'Authorization',
    'authorization',
    'AUTHORIZATION',
    'Cookie',
    'Set-Cookie',
    'X-API-Key',
    'x-api-key',
    'X-Auth-Token',
    'Proxy-Authorization',
  ])('flags %s', (header) => {
    expect(isSensitiveHeader(header)).toBe(true);
  });

  it.each(['Content-Type', 'Accept', 'User-Agent', 'Origin', 'Host'])(
    'does not flag %s',
    (header) => {
      expect(isSensitiveHeader(header)).toBe(false);
    },
  );
});

describe('redactHeaders', () => {
  it('redacts the value but keeps the header name as evidence', () => {
    const result = redactHeaders({
      Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.abc.def',
      'Content-Type': 'application/json',
    });

    expect(result.Authorization).toBe(REDACTED);
    // Keeping the name proves the request WAS authenticated — useful evidence.
    expect(result).toHaveProperty('Authorization');
    expect(result['Content-Type']).toBe('application/json');
  });

  it('redacts Basic credentials, which are trivially reversible', () => {
    const creds = Buffer.from('admin:hunter2').toString('base64');
    const result = redactHeaders({ Authorization: `Basic ${creds}` });
    expect(result.Authorization).toBe(REDACTED);
    expect(JSON.stringify(result)).not.toContain(creds);
  });

  it('handles undefined', () => {
    expect(redactHeaders(undefined)).toEqual({});
  });
});

describe('redactUrl', () => {
  it('redacts the SSE token that EventSource must pass in the query string', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature';
    const result = redactUrl(`/api/v1/assessments/abc/progress?token=${jwt}`);

    expect(result).not.toContain(jwt);
    expect(result).toContain(REDACTED);
    expect(result).toContain('/api/v1/assessments/abc/progress');
  });

  it('preserves non-sensitive parameters', () => {
    const result = redactUrl('/api/v1/findings?severity=HIGH&projectId=abc');
    expect(result).toBe('/api/v1/findings?severity=HIGH&projectId=abc');
  });

  it('redacts only the sensitive parameter in a mixed query', () => {
    const result = redactUrl('/x?page=2&access_token=abc123&sort=asc');
    expect(result).toContain('page=2');
    expect(result).toContain('sort=asc');
    expect(result).not.toContain('abc123');
  });

  it('leaves URLs without a query string unchanged', () => {
    expect(redactUrl('/api/v1/projects')).toBe('/api/v1/projects');
  });
});

describe('redactObject', () => {
  it('redacts sensitive leaves nested under non-sensitive parents', () => {
    const result = redactObject({
      user: 'analyst',
      config: { password: 'hunter2', nested: { api_key: 'sk-live-123' } },
    });

    expect(result.user).toBe('analyst');
    expect(result.config.password).toBe(REDACTED);
    expect(result.config.nested.api_key).toBe(REDACTED);
  });

  it('redacts the entire subtree when the KEY itself is sensitive', () => {
    // Deliberately conservative: a container called `auth` or `credentials` is
    // replaced wholesale rather than walked. We lose some structure in evidence,
    // but no sensitive leaf can escape because of an unrecognised key name.
    const result = redactObject({
      auth: { username: 'analyst', token: 'abc' },
      safe: 'kept',
    });

    expect(result.auth).toBe(REDACTED);
    expect(result.safe).toBe('kept');
    expect(JSON.stringify(result)).not.toContain('abc');
  });

  it('walks arrays', () => {
    const result = redactObject([{ token: 'abc' }, { safe: 'ok' }]);
    expect(result[0].token).toBe(REDACTED);
    expect(result[1].safe).toBe('ok');
  });

  it('survives deeply nested input without exhausting the stack', () => {
    let deep: any = { token: 'secret' };
    for (let i = 0; i < 200; i++) deep = { nested: deep };
    expect(() => redactObject(deep)).not.toThrow();
  });
});

describe('redactHttpMessage', () => {
  it('redacts the Authorization header line the scanner would otherwise persist', () => {
    // This is exactly what BasePlugin.buildRequestString used to store in
    // findings.httpRequest — the user's real bearer token.
    const token = 'eyJhbGciOiJIUzI1NiJ9.realtoken.sig';
    const message = [
      'GET https://api.example.com/users/1 HTTP/1.1',
      `Authorization: Bearer ${token}`,
      'User-Agent: APIAnalyser-Scanner/1.0',
    ].join('\n');

    const result = redactHttpMessage(message)!;

    expect(result).not.toContain(token);
    expect(result).toContain('Authorization:');
    expect(result).toContain('User-Agent: APIAnalyser-Scanner/1.0');
  });

  it('redacts Cookie and X-API-Key lines', () => {
    const result = redactHttpMessage(
      'GET / HTTP/1.1\nCookie: session=abc123def456\nX-API-Key: sk-live-secret-value',
    )!;
    expect(result).not.toContain('abc123def456');
    expect(result).not.toContain('sk-live-secret-value');
  });

  it('redacts credentials in JSON bodies', () => {
    const result = redactHttpMessage('POST /login\n\n{"user":"a","password":"hunter2"}')!;
    expect(result).not.toContain('hunter2');
    expect(result).toContain('"user":"a"');
  });

  it('redacts tokens embedded in URLs inside the message', () => {
    const result = redactHttpMessage('GET /cb?access_token=leaked-value HTTP/1.1')!;
    expect(result).not.toContain('leaked-value');
  });

  it('leaves clean evidence untouched', () => {
    const clean = 'GET https://api.example.com/health HTTP/1.1\nAccept: application/json';
    expect(redactHttpMessage(clean)).toBe(clean);
  });

  it('handles undefined', () => {
    expect(redactHttpMessage(undefined)).toBeUndefined();
  });
});

describe('isSensitiveParam', () => {
  it.each(['token', 'access_token', 'api_key', 'password', 'client_secret', 'signature'])(
    'flags %s',
    (param) => {
      expect(isSensitiveParam(param)).toBe(true);
    },
  );

  it.each(['page', 'severity', 'projectId', 'sort'])('does not flag %s', (param) => {
    expect(isSensitiveParam(param)).toBe(false);
  });
});
