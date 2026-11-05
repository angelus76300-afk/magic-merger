// 4.5.1 (audit): a refusal is not a description. Village's card read "I can't
// write this one as stated ... Here's a safer entry", and its program was then
// written from that text. The Worker never stores one (worker/index.ts,
// ensureDescription) and the page never keeps one in its cache (src/store.ts).
// Matched on how a refusal opens, or on its offer of a stand in, never on a
// word an item could carry ("a safer version of fire", "Sorry Ghost").
const OPENING =
  /^\W*(?:i\s*(?:can(?:'|’)?t|cannot|can not|won(?:'|’)?t|will not|am (?:not able|unable|not comfortable)|(?:'|’)m (?:not able|unable|sorry|not comfortable)|(?:'|’)d rather not)|sorry,|i apologi[sz]e)/i;
const OFFER =
  /\b(?:here(?:'|’)s|here is) a (?:safer|gentler)\b|\bas an ai\b|\bi (?:can(?:'|’)?t|cannot) (?:help|write|create|describe) (?:with )?(?:this|that)\b/i;

export function looksLikeRefusal(text: string): boolean {
  return OPENING.test(text) || OFFER.test(text);
}

// What the Worker answers when the model refused twice: shown, never kept.
export function noDescription(name: string): string {
  return `${name}: no description yet.`;
}

// Text a card must not keep: a refusal, or the stand in for one.
export function isPlaceholderDescription(text: string): boolean {
  return looksLikeRefusal(text) || /: no description yet\.$/.test(text);
}
