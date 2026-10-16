import { describe, expect, it } from 'vitest';
import { matchesAccepted, normalizeAnswer, stripAccents } from '../src/grading/normalize';
import { DEFAULT_MATCHING } from '../src/model/defaults';
import type { TextMatchingRules } from '../src/model/types';

const strict: TextMatchingRules = {
  caseInsensitive: false,
  trim: false,
  collapseWhitespace: false,
  ignorePunctuation: false,
  ignoreAccents: false,
};

describe('normalizeAnswer', () => {
  it('is an identity with every rule off', () => {
    expect(normalizeAnswer('  Had  Gone. ', strict)).toBe('  Had  Gone. ');
  });

  it('applies the default rules (case, trim, collapse whitespace)', () => {
    expect(normalizeAnswer('  Had   Gone ', DEFAULT_MATCHING)).toBe('had gone');
  });

  it('keeps punctuation and accents by default', () => {
    expect(normalizeAnswer("don't", DEFAULT_MATCHING)).toBe("don't");
    expect(normalizeAnswer('café', DEFAULT_MATCHING)).toBe('café');
  });

  it('removes punctuation only when asked', () => {
    expect(normalizeAnswer("don't!", { ...strict, ignorePunctuation: true })).toBe('dont');
  });

  it('strips accents only when asked, including Vietnamese đ', () => {
    expect(stripAccents('Đà Nẵng')).toBe('Da Nang');
    expect(normalizeAnswer('résumé', { ...strict, ignoreAccents: true })).toBe('resume');
  });

  it('treats composed and decomposed unicode as equal', () => {
    const composed = 'é';
    const decomposed = 'é';
    expect(normalizeAnswer(composed, strict)).toBe(normalizeAnswer(decomposed, strict));
  });

  it('does not fold distinct English words', () => {
    expect(normalizeAnswer('went', DEFAULT_MATCHING)).not.toBe(normalizeAnswer('go', DEFAULT_MATCHING));
    expect(normalizeAnswer('cats', DEFAULT_MATCHING)).not.toBe(normalizeAnswer('cat', DEFAULT_MATCHING));
    expect(normalizeAnswer('well-known', DEFAULT_MATCHING)).not.toBe(normalizeAnswer('well known', DEFAULT_MATCHING));
  });
});

describe('matchesAccepted', () => {
  it('matches any accepted answer', () => {
    expect(matchesAccepted('had gone', ['went', 'had gone'], DEFAULT_MATCHING)).toBe(true);
    expect(matchesAccepted('Went', ['went', 'had gone'], DEFAULT_MATCHING)).toBe(true);
    expect(matchesAccepted('goes', ['went', 'had gone'], DEFAULT_MATCHING)).toBe(false);
  });

  it('never matches an empty response, even if the key contains an empty string', () => {
    expect(matchesAccepted('', ['', 'x'], DEFAULT_MATCHING)).toBe(false);
    expect(matchesAccepted('   ', ['', 'x'], DEFAULT_MATCHING)).toBe(false);
  });

  it('is case sensitive when configured', () => {
    expect(matchesAccepted('Paris', ['paris'], { ...DEFAULT_MATCHING, caseInsensitive: false })).toBe(false);
  });
});
