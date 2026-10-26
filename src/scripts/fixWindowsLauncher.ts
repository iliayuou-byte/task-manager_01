import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import logger from '../core/logger.js';

const OLD_BRANCH = 'feature/daily-copilot-now';
const BRANCH = 'feat/personal-planning';

const replaceBranch = (source: Buffer): Buffer => {
  let bytes = source.toString('latin1');
  for (const encoding of ['utf8', 'utf16le', 'utf16be'] as const) {
    const encode = (text: string) => {
      const buffer = Buffer.from(
        text,
        encoding === 'utf8' ? 'utf8' : 'utf16le',
      );
      return (encoding === 'utf16be' ? buffer.swap16() : buffer).toString(
        'latin1',
      );
    };
    bytes = bytes.split(encode(OLD_BRANCH)).join(encode(BRANCH));
  }
  return Buffer.from(bytes, 'latin1');
};

export const repairWindowsLaunchers = async (
  directory: string,
  backupDirectory: string,
): Promise<Array<{ path: string; backup: string }>> => {
  const repaired: Array<{ path: string; backup: string }> = [];
  const backupRoot = join(
    backupDirectory,
    `${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  const visit = async (folder: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /\.(?:ps1|cmd|bat)$/i.test(entry.name)) {
        const original = await readFile(path);
        const updated = replaceBranch(original);
        if (updated.equals(original)) continue;
        const localPath = relative(directory, path);
        const backup = join(backupRoot, localPath);
        await mkdir(dirname(backup), { recursive: true });
        await writeFile(backup, original, { flag: 'wx' });
        const temporary = join(
          dirname(path),
          `.${entry.name}.${randomUUID()}.tmp`,
        );
        try {
          await writeFile(temporary, updated, { flag: 'wx' });
          await rename(temporary, path);
        } finally {
          await rm(temporary, { force: true });
        }
        repaired.push({ path: localPath, backup });
      }
    }
  };
  await visit(directory);
  return repaired;
};

if (import.meta.main) {
  const root = resolve(import.meta.dir, '../..');
  try {
    const repaired = await repairWindowsLaunchers(
      join(root, 'scripts', 'windows'),
      join(root, 'runtime', 'windows-launcher-backups'),
    );
    for (const item of repaired)
      logger.infoWithContext({
        op: 'WINDOWS_LAUNCHER',
        message: `Исправлен ${item.path}. Копия: ${item.backup}`,
      });
    logger.infoWithContext({
      op: 'WINDOWS_LAUNCHER',
      message: repaired.length
        ? `Ветка заменена на ${BRANCH}. Теперь можно использовать прежний запускатор.`
        : 'Ссылок на старую ветку не найдено. Файлы не менялись.',
    });
  } catch {
    logger.errorWithContext({
      op: 'WINDOWS_LAUNCHER',
      message:
        'Не удалось исправить запускатор. Проверь папку scripts/windows и доступ на запись. Резервные копии сохранены в runtime/windows-launcher-backups.',
    });
    process.exitCode = 1;
  }
}
