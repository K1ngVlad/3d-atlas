import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSeedFile, SeedError, stableUuid, toRows, validateSeed } from './seed-data';

/** Read-only fixtures from the Angular app: the same files Catalog seeds from. */
const PUBLIC_DIR = resolve(__dirname, '../../../../projects/app/public');

interface Manifest {
  id: string;
  status: string;
  parts: { id: string; entity: string }[];
}

function manifest(id: string): Manifest | null {
  const path = resolve(PUBLIC_DIR, 'manifests', `${id}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Manifest) : null;
}

describe('quiz seed file', () => {
  const seed = loadSeedFile();

  it('passes structural checks and contract shape', () => {
    expect(seed.quizzes.map((q) => q.id)).toEqual(['animal-cell-organelles', 'organelle-structure']);
    for (const quiz of seed.quizzes) {
      expect(quiz.questions.length).toBeGreaterThanOrEqual(8);
      expect(quiz.questions.length).toBeLessThanOrEqual(10);
      for (const q of quiz.questions) {
        expect(q.options.length).toBeGreaterThanOrEqual(3);
        expect(q.options.length).toBeLessThanOrEqual(5);
      }
      expect(quiz.questions.filter((q) => q.partId).length).toBeGreaterThanOrEqual(3);
      expect(quiz.questions.filter((q) => q.type === 'multiple').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('second quiz covers detailed models (≥ 2 mitochondrion, ≥ 2 golgi, endoplasmic-reticulum)', () => {
    const structure = seed.quizzes[1];
    const count = (m: string) => structure.questions.filter((q) => q.manifestId === m).length;
    expect(count('mitochondrion')).toBeGreaterThanOrEqual(2);
    expect(count('golgi')).toBeGreaterThanOrEqual(2);
    expect(count('endoplasmic-reticulum')).toBeGreaterThanOrEqual(1);
  });

  it('references only ready manifests and existing parts', () => {
    for (const quiz of seed.quizzes) {
      expect(manifest(quiz.manifestId)?.status).toBe('ready');
      for (const q of quiz.questions) {
        if (q.manifestId == null) continue;
        const m = manifest(q.manifestId);
        expect({ q: q.text, manifest: q.manifestId, status: m?.status }).toEqual({
          q: q.text,
          manifest: q.manifestId,
          status: 'ready',
        });
        if (q.partId != null) {
          expect(m!.parts.map((p) => p.id)).toContain(q.partId);
        }
      }
    }
  });

  it('references only existing catalog entities', () => {
    for (const quiz of seed.quizzes) {
      for (const q of quiz.questions) {
        expect({ entity: q.entityId, exists: existsSync(resolve(PUBLIC_DIR, 'content/entities', `${q.entityId}.json`)) }).toEqual({
          entity: q.entityId,
          exists: true,
        });
      }
    }
  });

  it('produces stable unique ids', () => {
    const a = toRows(seed);
    const b = toRows(seed);
    expect(a).toEqual(b);
    const ids = [...a.questions.map((q) => q.id), ...a.options.map((o) => o.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(stableUuid('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('validateSeed', () => {
  const quiz = (questions: unknown[]) => ({
    quizzes: [{ id: 'q', title: 'T', description: '', manifestId: 'animal-cell', questions }],
  });

  it('rejects single with two correct options', () => {
    expect(() =>
      validateSeed(quiz([{ type: 'single', text: 'x', entityId: 'e', options: [{ text: 'a', correct: true }, { text: 'b', correct: true }] }])),
    ).toThrow(/exactly one correct/);
  });

  it('rejects multiple without a wrong option and partId without manifestId', () => {
    let err: unknown;
    try {
      validateSeed(
        quiz([
          { type: 'multiple', text: 'x', entityId: 'e', options: [{ text: 'a', correct: true }, { text: 'b', correct: true }] },
          { type: 'single', text: 'y', entityId: 'e', partId: 'p', options: [{ text: 'a', correct: true }, { text: 'b' }] },
        ]),
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SeedError);
    expect((err as Error).message).toMatch(/at least two correct and one wrong/);
    expect((err as Error).message).toMatch(/partId is set without manifestId/);
  });
});
