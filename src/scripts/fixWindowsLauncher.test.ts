import { expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repairWindowsLaunchers } from './fixWindowsLauncher.js';

test('repairs local launchers with original bytes backed up and no repeat edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'launcher-branch-'));
  try {
    const scripts = join(root, 'scripts');
    const backups = join(root, 'backups');
    await mkdir(join(scripts, 'nested'), { recursive: true });
    const source =
      '# Ожидалась ветка\r\n$Branch = "feature/daily-copilot-now"\r\ngit pull origin feature/daily-copilot-now\r\n';
    const expected = source
      .split('feature/daily-copilot-now')
      .join('feat/personal-planning');
    const variants = [
      ['start.ps1', Buffer.from(source), Buffer.from(expected)],
      [
        'nested/start.cmd',
        Buffer.from(`\ufeff${source}`, 'utf16le'),
        Buffer.from(`\ufeff${expected}`, 'utf16le'),
      ],
      [
        'start.bat',
        Buffer.from(`\ufeff${source}`, 'utf16le').swap16(),
        Buffer.from(`\ufeff${expected}`, 'utf16le').swap16(),
      ],
    ] as const;
    for (const [path, bytes] of variants)
      await writeFile(join(scripts, path), bytes);
    await writeFile(join(scripts, 'notes.txt'), source);
    await writeFile(join(scripts, 'current.ps1'), expected);
    const repaired = await repairWindowsLaunchers(scripts, backups);
    expect(repaired.map((item) => item.path).sort()).toEqual(
      variants.map(([path]) => path).sort(),
    );
    for (const [path, original, updated] of variants) {
      expect(await readFile(join(scripts, path))).toEqual(updated);
      const backup = repaired.find((item) => item.path === path)!;
      expect(await readFile(backup.backup)).toEqual(original);
    }
    expect(await readFile(join(scripts, 'notes.txt'), 'utf8')).toBe(source);
    expect(await repairWindowsLaunchers(scripts, backups)).toEqual([]);
    expect((await readdir(backups)).length).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('failed replacement preserves the active launcher and its backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'launcher-failure-'));
  let rename: ReturnType<typeof spyOn> | undefined;
  try {
    const scripts = join(root, 'scripts');
    const backups = join(root, 'backups');
    await mkdir(scripts);
    const original = Buffer.from(
      'git pull origin feature/daily-copilot-now\r\n',
    );
    const launcher = join(scripts, 'start.ps1');
    await writeFile(launcher, original);
    rename = spyOn(fs, 'rename').mockRejectedValueOnce(
      new Error('replacement blocked'),
    );
    await expect(repairWindowsLaunchers(scripts, backups)).rejects.toThrow(
      'replacement blocked',
    );
    expect(await readFile(launcher)).toEqual(original);
    expect(await readdir(scripts)).toEqual(['start.ps1']);
    const versions = await readdir(backups);
    expect(await readFile(join(backups, versions[0], 'start.ps1'))).toEqual(
      original,
    );
    rename.mockRestore();
    rename = undefined;
    expect(await repairWindowsLaunchers(scripts, backups)).toHaveLength(1);
  } finally {
    rename?.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
