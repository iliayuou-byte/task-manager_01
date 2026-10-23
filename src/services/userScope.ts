import { AsyncLocalStorage } from 'node:async_hooks';
import { posix } from 'node:path';

const users = new AsyncLocalStorage<number>();

export const profileUsers = (): number[] => [
  ...new Set(
    (process.env.TELEGRAM_BOT_ALLOWLIST || '')
      .split(',')
      .filter((id) => id.trim())
      .map((id) => Number(id.trim())),
  ),
];

export const profileOwner = (): number | undefined => {
  const allowed = profileUsers();
  if (allowed.some((id) => !Number.isSafeInteger(id) || id <= 0))
    throw new Error(
      'TELEGRAM_BOT_ALLOWLIST must contain positive Telegram IDs',
    );
  const configured = process.env.BOT_OWNER_ID;
  if (!configured) {
    if (allowed.length > 1)
      throw new Error('Set BOT_OWNER_ID before allowing multiple users');
    return allowed[0];
  }
  const owner = Number(configured);
  if (!Number.isSafeInteger(owner) || !allowed.includes(owner))
    throw new Error('BOT_OWNER_ID must be a Telegram ID in the allowlist');
  if ((process.env.STORAGE_PROVIDER || 'github').toLowerCase() !== 'github')
    throw new Error('Separate user profiles currently require GitHub storage');
  return owner;
};

export const runForUser = <T>(id: number, action: () => T): T => {
  profileOwner();
  if (!profileUsers().includes(id)) throw new Error('User is not allowed');
  return users.run(id, action);
};

export const profileFilePath = (basePath: string): string => {
  const owner = profileOwner();
  if (!process.env.BOT_OWNER_ID) return basePath;
  const id = users.getStore();
  // Never silently fall back to the owner's file in a background job.
  if (!id || !profileUsers().includes(id))
    throw new Error('User storage scope is missing');
  return id === owner
    ? basePath
    : posix.join(posix.dirname(basePath), 'users', `${id}.md`);
};

export const canUseOwnerCalendar = (): boolean =>
  !process.env.BOT_OWNER_ID || users.getStore() === profileOwner();
