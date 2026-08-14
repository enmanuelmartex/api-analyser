import { describe, expect, it } from 'bun:test';
import { InvalidRecipientError, mergeRecipients, parseEmailList } from './email-list';

/**
 * Parsing the recipient list.
 *
 * Worth its own file because both failure directions are costly: accepting
 * something that is not an address means a report that silently never
 * delivers, and rejecting a valid one means an operator whose saved setting
 * quietly lost an entry.
 */

describe('parseEmailList', () => {
  it('accepts an array, as the API and the database supply it', () => {
    expect(parseEmailList(['a@corp.example', 'b@corp.example'])).toEqual([
      'a@corp.example',
      'b@corp.example',
    ]);
  });

  it('accepts a comma-separated string, as an env variable supplies it', () => {
    // A JSON array in a .env file is hostile to type, so the env form is plain.
    expect(parseEmailList('a@corp.example,b@corp.example')).toEqual([
      'a@corp.example',
      'b@corp.example',
    ]);
  });

  it.each([';', '\n', ', ', ' ;\n'])('splits on %j too', (separator) => {
    expect(parseEmailList(`a@corp.example${separator}b@corp.example`)).toEqual([
      'a@corp.example',
      'b@corp.example',
    ]);
  });

  it('treats nothing as an empty list', () => {
    expect(parseEmailList('')).toEqual([]);
    expect(parseEmailList([])).toEqual([]);
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList(null)).toEqual([]);
  });

  it('trims and ignores blank entries', () => {
    expect(parseEmailList('  a@corp.example ,, , b@corp.example  ')).toEqual([
      'a@corp.example',
      'b@corp.example',
    ]);
  });

  it('lower-cases, which is what makes de-duplication work', () => {
    expect(parseEmailList(['Security@Corp.Example'])).toEqual(['security@corp.example']);
  });

  it('de-duplicates case-insensitively', () => {
    expect(parseEmailList('a@corp.example,A@CORP.EXAMPLE')).toEqual(['a@corp.example']);
  });

  it.each([
    'plainstring',
    '@corp.example',
    'a@',
    'a@corp',
    'a b@corp.example',
    'a@corp .example',
    'a@@corp.example',
    'a<b@corp.example',
    'a@corp.example;b',
  ])('rejects %j', (value) => {
    expect(() => parseEmailList([value])).toThrow(InvalidRecipientError);
  });

  it('rejects rather than silently dropping', () => {
    // A dropped address is a report nobody receives and nobody knows is missing.
    expect(() => parseEmailList('good@corp.example,broken')).toThrow(InvalidRecipientError);
  });

  it('names the offending address, so the operator knows which one', () => {
    try {
      parseEmailList(['good@corp.example', 'typo@corp']);
      throw new Error('expected it to throw');
    } catch (error) {
      expect((error as InvalidRecipientError).address).toBe('typo@corp');
      expect((error as Error).message).toContain('typo@corp');
    }
  });

  it('rejects an absurdly long address', () => {
    expect(() => parseEmailList([`${'a'.repeat(300)}@corp.example`])).toThrow(
      InvalidRecipientError,
    );
  });

  it('rejects a value that is not a list in any reading', () => {
    expect(() => parseEmailList(42)).toThrow(InvalidRecipientError);
    expect(() => parseEmailList({ a: 1 })).toThrow(InvalidRecipientError);
  });

  it('accepts the shapes real addresses take', () => {
    expect(
      parseEmailList([
        'first.last@corp.example',
        'first+reports@corp.example',
        'first_last@sub.corp.example',
        "o'brien@corp.example",
        'a@corp.co.uk',
      ]),
    ).toHaveLength(5);
  });
});

describe('mergeRecipients', () => {
  it('preserves the order of first appearance', () => {
    expect(mergeRecipients(['a@x.example'], ['b@x.example'])).toEqual([
      'a@x.example',
      'b@x.example',
    ]);
  });

  it('de-duplicates across lists, case-insensitively', () => {
    expect(mergeRecipients(['A@x.example'], ['a@x.example'])).toEqual(['A@x.example']);
  });

  it('ignores blanks', () => {
    expect(mergeRecipients(['', '  '], ['a@x.example'])).toEqual(['a@x.example']);
  });
});
