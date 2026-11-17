import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Default location of the seed file (works from both `src/seed` and `dist/seed`). */
export const DEFAULT_SEED_FILE = resolve(__dirname, '../../prisma/seed/quizzes.json');

export type QuestionType = 'single' | 'multiple';

export interface SeedOption {
  text: string;
  correct?: boolean;
}

export interface SeedQuestion {
  type: QuestionType;
  text: string;
  entityId: string;
  manifestId?: string | null;
  partId?: string | null;
  options: SeedOption[];
}

export interface SeedQuiz {
  id: string;
  title: string;
  description: string;
  manifestId: string;
  questions: SeedQuestion[];
}

export interface SeedFile {
  quizzes: SeedQuiz[];
}

/** Rows ready for insertion: ids are deterministic, so a reseed keeps question ids stable for Analytics. */
export interface SeedRows {
  quizzes: { id: string; title: string; description: string; manifestId: string }[];
  questions: {
    id: string;
    quizId: string;
    position: number;
    type: QuestionType;
    text: string;
    entityId: string;
    manifestId: string | null;
    partId: string | null;
  }[];
  options: { id: string; questionId: string; position: number; text: string; isCorrect: boolean }[];
}

export class SeedError extends Error {
  constructor(problems: string[]) {
    super(`Invalid quiz seed:\n  - ${problems.join('\n  - ')}`);
    this.name = 'SeedError';
  }
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Structural checks from contracts.md ("Проверки seed"). Throws SeedError listing every problem. */
export function validateSeed(data: unknown): SeedFile {
  const problems: string[] = [];
  const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
  const root = data as SeedFile;
  if (!root || !Array.isArray(root.quizzes) || root.quizzes.length === 0) {
    throw new SeedError(['root must be { "quizzes": [ ... ] } with at least one quiz']);
  }
  const quizIds = new Set<string>();
  root.quizzes.forEach((quiz, qi) => {
    const at = `quizzes[${qi}]${isStr(quiz?.id) ? ` (${quiz.id})` : ''}`;
    if (!isStr(quiz?.id) || !SLUG.test(quiz.id)) problems.push(`${at}: id must be a slug`);
    else if (quizIds.has(quiz.id)) problems.push(`${at}: duplicate quiz id`);
    else quizIds.add(quiz.id);
    if (!isStr(quiz?.title)) problems.push(`${at}: title is required`);
    if (typeof quiz?.description !== 'string') problems.push(`${at}: description is required`);
    if (!isStr(quiz?.manifestId)) problems.push(`${at}: manifestId is required`);
    if (!Array.isArray(quiz?.questions) || quiz.questions.length === 0) {
      problems.push(`${at}: questions must be a non-empty array`);
      return;
    }
    quiz.questions.forEach((q, i) => {
      const qat = `${at} question ${i + 1}`;
      if (q.type !== 'single' && q.type !== 'multiple') problems.push(`${qat}: type must be "single" or "multiple"`);
      if (!isStr(q.text)) problems.push(`${qat}: text is required`);
      if (!isStr(q.entityId)) problems.push(`${qat}: entityId is required`);
      if (q.manifestId != null && !isStr(q.manifestId)) problems.push(`${qat}: manifestId must be a non-empty string or null`);
      if (q.partId != null) {
        if (!isStr(q.partId)) problems.push(`${qat}: partId must be a non-empty string or null`);
        if (q.manifestId == null) problems.push(`${qat}: partId is set without manifestId`);
      }
      if (!Array.isArray(q.options) || q.options.length < 2) {
        problems.push(`${qat}: at least two options are required`);
        return;
      }
      q.options.forEach((o, oi) => {
        if (!isStr(o?.text)) problems.push(`${qat} option ${oi + 1}: text is required`);
        if (o?.correct !== undefined && typeof o.correct !== 'boolean') problems.push(`${qat} option ${oi + 1}: correct must be boolean`);
      });
      const texts = q.options.map((o) => o?.text);
      if (new Set(texts).size !== texts.length) problems.push(`${qat}: duplicate option texts`);
      const correct = q.options.filter((o) => o?.correct === true).length;
      const wrong = q.options.length - correct;
      if (q.type === 'single' && correct !== 1) problems.push(`${qat}: "single" needs exactly one correct option (has ${correct})`);
      if (q.type === 'multiple' && (correct < 2 || wrong < 1)) {
        problems.push(`${qat}: "multiple" needs at least two correct and one wrong option (has ${correct}/${wrong})`);
      }
    });
  });
  if (problems.length) throw new SeedError(problems);
  return root;
}

/** Name-based UUID (RFC 4122 version 5 layout over SHA-1) — stable ids for seeded rows. */
export function stableUuid(name: string): string {
  const h = createHash('sha1').update(`atlas-quiz:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function toRows(seed: SeedFile): SeedRows {
  const rows: SeedRows = { quizzes: [], questions: [], options: [] };
  for (const quiz of seed.quizzes) {
    rows.quizzes.push({ id: quiz.id, title: quiz.title, description: quiz.description, manifestId: quiz.manifestId });
    quiz.questions.forEach((q, i) => {
      const position = i + 1;
      const questionId = stableUuid(`${quiz.id}/q${position}`);
      rows.questions.push({
        id: questionId,
        quizId: quiz.id,
        position,
        type: q.type,
        text: q.text,
        entityId: q.entityId,
        manifestId: q.manifestId ?? null,
        partId: q.partId ?? null,
      });
      q.options.forEach((o, oi) => {
        rows.options.push({
          id: stableUuid(`${quiz.id}/q${position}/o${oi + 1}`),
          questionId,
          position: oi + 1,
          text: o.text,
          isCorrect: o.correct === true,
        });
      });
    });
  }
  return rows;
}

export function loadSeedFile(path = DEFAULT_SEED_FILE): SeedFile {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new SeedError([`cannot read ${path}: ${(e as Error).message}`]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new SeedError([`${path} is not valid JSON: ${(e as Error).message}`]);
  }
  return validateSeed(parsed);
}
