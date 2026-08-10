import { describe, expect, it } from 'bun:test';
import { GuidanceContextResolver } from './guidance-context.resolver';
import { SecurityKnowledgeRegistry } from './security-knowledge.registry';

const resolver = new GuidanceContextResolver();

function response(headers: Record<string, string>, body = '{}'): string {
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  return `HTTP/1.1 200\n${lines.join('\n')}\n\n${body}`;
}

describe('GuidanceContextResolver', () => {
  it('reports unknown when there is nothing to go on', () => {
    const context = resolver.resolve({ httpResponse: response({ 'content-type': 'application/json' }) });

    expect(context.isUnknown).toBe(true);
    expect(context.technologies).toEqual([]);
    expect(context.allowed.size).toBe(0);
  });

  it('handles a missing response without throwing', () => {
    expect(resolver.resolve({}).isUnknown).toBe(true);
    expect(resolver.resolve({ httpResponse: null }).isUnknown).toBe(true);
  });

  it('detects a framework from X-Powered-By', () => {
    const context = resolver.resolve({ httpResponse: response({ 'X-Powered-By': 'Express' }) });

    const express = context.technologies.find((t) => t.name === 'express');
    expect(express?.confidence).toBe('DETECTED');
    expect(express?.evidence).toContain('x-powered-by');
    expect(context.allowed.get('express')).toBe('DETECTED');
  });

  it('detects a cloud provider from a request-id header', () => {
    const context = resolver.resolve({ httpResponse: response({ 'x-amzn-RequestId': 'abc-123' }) });
    expect(context.technologies.some((t) => t.name === 'aws')).toBe(true);
  });

  it('treats a session cookie as inferred, not detected', () => {
    const context = resolver.resolve({
      httpResponse: response({ 'set-cookie': 'connect.sid=abc; HttpOnly' }),
    });

    expect(context.technologies.find((t) => t.name === 'express')?.confidence).toBe('INFERRED');
  });

  it('does not treat a reverse proxy as the application framework', () => {
    const context = resolver.resolve({ httpResponse: response({ Server: 'nginx/1.25' }) });

    expect(context.technologies.map((t) => t.name)).toEqual(['nginx']);
    // nginx being present must not imply anything about the app behind it.
    expect(context.allowed.has('express')).toBe(false);
    expect(context.allowed.has('nestjs')).toBe(false);
  });

  it('lets a stronger basis win over a weaker one for the same technology', () => {
    const context = resolver.resolve({
      httpResponse: response({
        'X-Powered-By': 'Express',
        'set-cookie': 'connect.sid=abc',
      }),
    });

    const express = context.technologies.filter((t) => t.name === 'express');
    expect(express).toHaveLength(1);
    expect(express[0].confidence).toBe('DETECTED');
  });

  it('records the configured auth type as user-configured, not detected', () => {
    const context = resolver.resolve({ authType: 'BEARER' });

    const jwt = context.technologies.find((t) => t.name === 'jwt');
    expect(jwt?.confidence).toBe('USER_CONFIGURED');
    expect(context.isUnknown).toBe(false);
  });

  it('ignores an auth type of NONE', () => {
    expect(resolver.resolve({ authType: 'NONE' }).isUnknown).toBe(true);
  });

  it('does not mistake body content for headers', () => {
    const context = resolver.resolve({
      httpResponse: response({ 'content-type': 'application/json' }, '{"server":"nginx","x-powered-by":"Express"}'),
    });

    expect(context.isUnknown).toBe(true);
  });
});

describe('SecurityKnowledgeRegistry', () => {
  const registry = new SecurityKnowledgeRegistry();

  it('exposes a stable version stamped onto stored guidance', () => {
    expect(registry.version).toMatch(/^knowledge-/);
  });

  it('returns nothing when no key matches, rather than everything', () => {
    const selection = registry.select({ owaspCategory: 'API99:2023' });
    expect(selection.playbooks).toEqual([]);
  });

  it('selects the playbook for an OWASP category', () => {
    const selection = registry.select({ owaspCategory: 'API1:2023' });

    expect(selection.playbooks).toHaveLength(1);
    expect(selection.playbooks[0].id).toBe('owasp/api1-bola');
  });

  it('matches case-insensitively', () => {
    expect(registry.select({ owaspCategory: 'api8:2023' }).playbooks.length).toBeGreaterThan(0);
  });

  it('combines category and technology playbooks without duplicates', () => {
    const selection = registry.select({
      owaspCategory: 'API8:2023',
      technologies: ['express', 'nginx', 'express'],
    });

    const ids = selection.playbooks.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('owasp/api8-misconfiguration');
    expect(ids).toContain('frameworks/express');
    expect(ids).toContain('infra/nginx');
  });

  it('gives every playbook at least one citable reference', () => {
    for (const playbook of registry.all()) {
      expect(playbook.references.length).toBeGreaterThan(0);
      for (const reference of playbook.references) {
        expect(reference.url).toMatch(/^https:\/\//);
      }
    }
  });
});
