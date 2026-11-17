// NestJS 12 is ESM-only and Jest on Node 22 cannot require() ESM, so tests run in Jest's ESM mode
// (`node --experimental-vm-modules`); production code is still compiled to CommonJS by tsc.
export default {
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '\.(spec|int-spec)\.ts$',
  testPathIgnorePatterns: ['/generated/'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: { '^.+\.ts$': ['ts-jest', { useESM: true, tsconfig: '<rootDir>/../tsconfig.spec.json' }] },
};
