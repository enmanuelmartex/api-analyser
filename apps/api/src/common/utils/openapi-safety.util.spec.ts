import { BadRequestException } from '@nestjs/common';
import {
  assertNoExternalRefs,
  isOpenApi31Document,
  isExternalRef,
  SAFE_PARSER_OPTIONS,
} from './openapi-safety.util';

describe('isOpenApi31Document', () => {
  it.each(['3.1.0', '3.1.1', '3.1'])('recognizes OpenAPI %s', (openapi) => {
    expect(isOpenApi31Document({ openapi })).toBe(true);
  });

  it.each(['3.0.3', '2.0', '', null])('does not classify %s as OpenAPI 3.1', (openapi) => {
    expect(isOpenApi31Document({ openapi })).toBe(false);
  });
});

describe('isExternalRef', () => {
  it.each(['#/components/schemas/User', '#/paths/~1users/get', '#'])(
    'treats %s as internal',
    (ref) => {
      expect(isExternalRef(ref)).toBe(false);
    },
  );

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'https://attacker.example.com/schema.json',
    'file:///etc/passwd',
    './common.yaml#/User',
    '../shared/schema.json',
    'schema.json',
  ])('treats %s as external', (ref) => {
    expect(isExternalRef(ref)).toBe(true);
  });

  it('ignores non-strings and empty values', () => {
    for (const value of [null, undefined, 42, {}, '']) {
      expect(isExternalRef(value)).toBe(false);
    }
  });
});

describe('assertNoExternalRefs', () => {
  const validSpec = {
    openapi: '3.0.0',
    info: { title: 'Test', version: '1.0.0' },
    paths: {
      '/users': {
        get: {
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/User' },
                },
              },
            },
          },
        },
      },
    },
    components: { schemas: { User: { type: 'object' } } },
  };

  it('accepts a spec that only uses internal refs', () => {
    expect(() => assertNoExternalRefs(validSpec)).not.toThrow();
  });

  it('blocks SSRF to cloud instance metadata', () => {
    // Without this guard SwaggerParser.dereference would FETCH this URL
    // server-side during spec import — on the upload path, which never goes
    // through assertSafeRemoteUrl.
    const hostile = {
      openapi: '3.0.0',
      paths: {
        '/x': {
          get: {
            parameters: [{ $ref: 'http://169.254.169.254/latest/meta-data/iam/' }],
          },
        },
      },
    };

    expect(() => assertNoExternalRefs(hostile)).toThrow(BadRequestException);
  });

  it('blocks local file disclosure via file:// refs', () => {
    const hostile = { components: { schemas: { X: { $ref: 'file:///etc/passwd' } } } };
    expect(() => assertNoExternalRefs(hostile)).toThrow(BadRequestException);
  });

  it('blocks relative refs that would read adjacent files', () => {
    const hostile = { paths: { '/a': { $ref: '../../../secrets.yaml' } } };
    expect(() => assertNoExternalRefs(hostile)).toThrow(BadRequestException);
  });

  it('finds refs nested deep inside arrays and objects', () => {
    const hostile = {
      paths: {
        '/a': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    allOf: [
                      { type: 'object' },
                      { $ref: 'https://attacker.example.com/evil.json' },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    };

    expect(() => assertNoExternalRefs(hostile)).toThrow(BadRequestException);
  });

  it('names the offending reference so the user can fix the document', () => {
    const hostile = { $ref: 'https://attacker.example.com/evil.json' };
    expect(() => assertNoExternalRefs(hostile)).toThrow(/attacker\.example\.com/);
  });

  it('does not throw on primitives or empty documents', () => {
    for (const value of [null, undefined, {}, [], 'string', 42]) {
      expect(() => assertNoExternalRefs(value)).not.toThrow();
    }
  });

  it('survives a self-referential document', () => {
    const cyclic: any = { openapi: '3.0.0' };
    cyclic.self = cyclic;
    // Depth-limited walk: must terminate rather than hang or overflow.
    expect(() => assertNoExternalRefs(cyclic)).not.toThrow(RangeError);
  });
});

describe('SAFE_PARSER_OPTIONS', () => {
  it('disables every external resolver as defence in depth', () => {
    expect(SAFE_PARSER_OPTIONS.resolve.external).toBe(false);
    expect(SAFE_PARSER_OPTIONS.resolve.http).toBe(false);
    expect(SAFE_PARSER_OPTIONS.resolve.file).toBe(false);
  });
});
