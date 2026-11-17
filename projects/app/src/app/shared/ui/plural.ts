/** Русское множественное число: `pluralRu(5, ['вопрос', 'вопроса', 'вопросов'])` → «вопросов». */
export function pluralRu(n: number, forms: readonly [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export const QUESTION_FORMS = ['вопрос', 'вопроса', 'вопросов'] as const;
