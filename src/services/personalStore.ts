import path from 'node:path';
import type { Octokit } from '@octokit/rest';
import { getGitHubFileInfo, getOctokit } from '../clients/github.js';
import {
  createPersonalState,
  type PersonalState,
  personalStateSchema,
} from './personal.js';
import { profileOwner } from './userScope.js';

export interface PersonalBackend {
  read(): Promise<{ state: unknown; revision?: string }>;
  write(state: PersonalState, revision?: string): Promise<void>;
}
const statusOf = (error: unknown): number | undefined =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  typeof error.status === 'number'
    ? error.status
    : undefined;

export class PersonalStore {
  constructor(
    readonly ownerId: number,
    private backend: PersonalBackend,
  ) {}

  private validate(value: unknown): PersonalState {
    const state = personalStateSchema.parse(value);
    if (state.ownerId !== this.ownerId)
      throw new Error('Личное хранилище принадлежит другому владельцу.');
    return state;
  }

  async read(): Promise<PersonalState> {
    return this.validate((await this.backend.read()).state);
  }

  // The callback only changes data; external effects happen after the commit.
  async update(change: (state: PersonalState) => void): Promise<PersonalState> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await this.backend.read();
      const state = this.validate(snapshot.state);
      const before = JSON.stringify(state);
      change(state);
      const validated = this.validate(state);
      if (before === JSON.stringify(validated)) return validated;
      try {
        await this.backend.write(validated, snapshot.revision);
        return validated;
      } catch (error) {
        if (statusOf(error) !== 409 || attempt === 2) throw error;
      }
    }
    throw new Error('Не удалось сохранить изменения. Попробуй ещё раз.');
  }
}

interface FileInfo {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
}

export class GitHubPersonalBackend implements PersonalBackend {
  constructor(
    private client: Octokit,
    private info: FileInfo,
    private ownerId: number,
  ) {}

  private async assertPrivate() {
    const { owner, repo } = this.info;
    const { data } = await this.client.repos.get({ owner, repo });
    if (!data.private)
      throw new Error('Репозиторий данных должен быть приватным.');
  }

  async read() {
    await this.assertPrivate();
    const { owner, repo, branch, filePath } = this.info;
    try {
      const { data } = await this.client.repos.getContent({
        owner,
        repo,
        path: filePath,
        ref: branch,
      });
      if (Array.isArray(data) || data.type !== 'file')
        throw new Error('Личное хранилище должно быть файлом.');
      return {
        state: JSON.parse(
          Buffer.from(data.content, 'base64').toString('utf8'),
        ) as unknown,
        revision: data.sha,
      };
    } catch (error) {
      if (statusOf(error) !== 404) throw error;
      return { state: createPersonalState(this.ownerId) };
    }
  }

  async write(state: PersonalState, revision?: string) {
    await this.assertPrivate();
    const { owner, repo, branch, filePath } = this.info;
    await this.client.repos.createOrUpdateFileContents({
      owner,
      repo,
      branch,
      path: filePath,
      message: '[bot] update personal system',
      content: Buffer.from(JSON.stringify(state, null, 2)).toString('base64'),
      ...(revision ? { sha: revision } : {}),
    });
  }
}

export const personalEnabled = () =>
  process.env.PERSONAL_SYSTEM_ENABLED === 'true';

export const getPersonalStore = async (): Promise<PersonalStore> => {
  if (!personalEnabled())
    throw new Error(
      'Личная система отключена. Установи PERSONAL_SYSTEM_ENABLED=true на компьютере с ботом.',
    );
  if ((process.env.STORAGE_PROVIDER ?? 'github').toLowerCase() !== 'github')
    throw new Error('Личная система пока поддерживает хранилище GitHub.');
  const ownerId = profileOwner();
  if (ownerId === undefined || !Number.isSafeInteger(ownerId) || ownerId <= 0)
    throw new Error('Укажи владельца в TELEGRAM_BOT_ALLOWLIST и BOT_OWNER_ID.');
  const info = getGitHubFileInfo();
  const filePath = path.posix.join(
    path.posix.dirname(info.filePath),
    'personal-system.json',
  );
  if (filePath === info.filePath)
    throw new Error('FILE_PATH должен указывать на Markdown-таблицу задач.');
  return new PersonalStore(
    ownerId,
    new GitHubPersonalBackend(
      await getOctokit(),
      { ...info, filePath },
      ownerId,
    ),
  );
};
