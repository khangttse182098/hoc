import type { TextMatchingRules } from '../model/types';

/**
 * Normalizes a free-text answer according to the question's matching rules.
 * Deliberately conservative: no stemming, no plural folding, no synonym
 * handling, so distinct English words never collapse into each other.
 */
export function normalizeAnswer(input: string, rules: TextMatchingRules): string {
  let s = input ?? '';
  // Unicode-normalize first so composed/decomposed forms compare equal.
  s = s.normalize('NFC');
  if (rules.ignoreAccents) s = stripAccents(s);
  if (rules.ignorePunctuation) s = s.replace(/[\p{P}\p{S}]/gu, '');
  if (rules.caseInsensitive) s = s.toLowerCase();
  if (rules.collapseWhitespace) s = s.replace(/\s+/g, ' ');
  if (rules.trim) s = s.trim();
  return s;
}

/** Removes diacritics; also maps Vietnamese đ/Đ which NFD does not decompose. */
export function stripAccents(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFC');
}

/** True if `response` equals any accepted answer under the given rules. */
export function matchesAccepted(response: string, accepted: string[], rules: TextMatchingRules): boolean {
  const r = normalizeAnswer(response, rules);
  if (r === '') return false;
  return accepted.some((a) => normalizeAnswer(a, rules) === r);
}
