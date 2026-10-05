import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcribeLocalVoice } from './localVoice.js';

test('local subprocess receives bytes through stdin and returns a UTF-8 transcript', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'local-voice-'));
  const script = join(directory, 'test.py');
  writeFileSync(
    script,
    'import sys,json\naudio=sys.stdin.buffer.read()\nassert audio == bytes([1,2,3])\nprint(json.dumps({"text":"  Купить продукты  "},ensure_ascii=False))\n',
  );
  try {
    expect(
      await transcribeLocalVoice(new Uint8Array([1, 2, 3]), {
        python: 'python3',
        script,
      }),
    ).toBe('Купить продукты');
    writeFileSync(script, 'import sys\nsys.exit(2)\n');
    await expect(
      transcribeLocalVoice(new Uint8Array([1]), { python: 'python3', script }),
    ).rejects.toMatchObject({ code: 'setup' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
