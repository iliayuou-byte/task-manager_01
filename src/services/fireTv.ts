import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export const normalizeFireTvHost = (input: string): string => {
  const host = input.trim();
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match || match.slice(1).some((part) => Number(part) > 255))
    throw new Error('Введи локальный IPv4 телевизора, например 192.168.1.50.');
  const octets = match.slice(1).map(Number);
  const privateAddress =
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
  if (!privateAddress)
    throw new Error('Укажи локальный адрес телевизора из домашней сети.');
  return host;
};

export const normalizeYoutubeUrl = (input: string): string => {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`Не удалось прочитать ссылку: ${input}`);
  }
  if (url.protocol !== 'https:')
    throw new Error('Подойдут только HTTPS-ссылки на YouTube.');
  let id: string | null = null;
  if (['youtu.be', 'www.youtu.be'].includes(url.hostname))
    id = url.pathname.split('/').filter(Boolean)[0] || null;
  else if (
    ['youtube.com', 'www.youtube.com', 'music.youtube.com'].includes(
      url.hostname,
    )
  ) {
    id = url.searchParams.get('v');
    if (!id && /^\/(?:shorts|live)\//.test(url.pathname))
      id = url.pathname.split('/')[2] || null;
  }
  if (!id || !VIDEO_ID.test(id))
    throw new Error(`Нужна ссылка на отдельное видео YouTube: ${input}`);
  return `https://youtu.be/${id}`;
};

export const parseFireTvMedia = (input: string): string[] => {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 20) throw new Error('Добавь не больше 20 YouTube-ссылок.');
  return [...new Set(lines.map(normalizeYoutubeUrl))];
};

const adbPath = () => process.env.FIRE_TV_ADB_PATH?.trim() || 'adb';
const endpoint = (host: string) => `${normalizeFireTvHost(host)}:5555`;

const runAdb = async (host: string, args: string[]) => {
  const device = endpoint(host);
  const connection = await execFile(adbPath(), ['connect', device], {
    timeout: 12_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (
    /unable to connect|failed to connect|cannot connect/i.test(
      `${connection.stdout}\n${connection.stderr}`,
    )
  )
    throw new Error('ADB не смог подключиться к телевизору.');
  return execFile(adbPath(), ['-s', device, ...args], {
    timeout: 12_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
};

export const assertFireTvActivityStarted = (output: string) => {
  if (
    /(?:\bError:|Activity not started|SecurityException|Status:\s*(?:timeout|error))/i.test(
      output,
    )
  )
    throw new Error('Телевизор не смог открыть видео через ADB.');
};

const startVideo = async (host: string, url: string, packageName?: string) => {
  const args = [
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.VIEW',
    ...(packageName ? ['-p', packageName] : []),
    '-d',
    url,
  ];
  const result = await runAdb(host, args);
  assertFireTvActivityStarted(`${result.stdout}\n${result.stderr}`);
};

export const wakeFireTv = async (
  host: string,
  media: readonly string[] = [],
): Promise<string | undefined> => {
  await runAdb(host, ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
  const links = media.map(normalizeYoutubeUrl);
  if (!links.length) return undefined;
  const url = links[Math.floor(Math.random() * links.length)];
  const id = url.slice(-11);
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  // Fire OS may still be restoring the foreground app after KEYCODE_WAKEUP.
  await new Promise((resolve) => setTimeout(resolve, 6000));
  let youtubeInstalled = false;
  try {
    const packages = await runAdb(host, [
      'shell',
      'pm',
      'path',
      'com.amazon.firetv.youtube',
    ]);
    youtubeInstalled = /\bpackage:/.test(packages.stdout);
  } catch {
    // Older Fire OS versions may not support this package lookup.
  }
  if (youtubeInstalled) {
    try {
      await startVideo(host, watchUrl, 'com.amazon.firetv.youtube');
      return url;
    } catch {
      // Some Fire OS versions have the app but do not export its URL handler.
    }
  }
  await startVideo(host, watchUrl);
  return url;
};
