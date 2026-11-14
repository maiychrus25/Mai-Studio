import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('documentation checker catches version and limit drift in a controlled project', () => {
  const checker = require(resolve('scripts/check-docs.js')) as { runChecks(root: string): string[] };
  const root = mkdtempSync(join(tmpdir(), 'maistudio-docs-'));
  try {
    mkdirSync(join(root, 'src')); writeFileSync(join(root, 'package.json'), '{"version":"1.0.0"}');
    for (const file of ['README.md', 'DESIGN.md', 'AGENTS.md']) writeFileSync(join(root, file), 'Project document');
    writeFileSync(join(root, 'src/limits.ts'), 'export const LIMIT = 4;');
    writeFileSync(join(root, 'SYSTEM_DOCUMENTATION.md'), 'Phiên bản ứng dụng được khảo sát: `1.0.0`\n<!-- docs-check: src/limits.ts#LIMIT = 4 -->');
    assert.deepEqual(checker.runChecks(root), []);
    writeFileSync(join(root, 'src/limits.ts'), 'export const LIMIT = 5;');
    assert.ok(checker.runChecks(root).some(message => message.includes('LIMIT')));
    writeFileSync(join(root, 'package.json'), '{"version":"2.0.0"}');
    assert.ok(checker.runChecks(root).some(message => message.includes('phiên bản')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
