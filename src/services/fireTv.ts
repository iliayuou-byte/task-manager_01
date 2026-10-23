import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const FIRE_TV_VOLUME_PERCENT = 25;
const MUSIC_STREAM = '3';

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

export const volumeIndexForPercent = (
  min: number,
  max: number,
  percent: number,
): number => {
  if (
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    max <= min ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100
  )
    throw new Error('Некорректный диапазон громкости телевизора.');
  return Math.round(min + ((max - min) * percent) / 100);
};

const parseVolumeInfo = (output: string) => {
  const volumeMatch = output.match(/volume is\s+(\d+)/i);
  const currentLine = output.match(
    /Current:\s*(\d+)(?:\s+\([^)]*\):\s*(\d+))?/i,
  );
  const rangeMatch = output.match(/range\s+\[(\d+)\.\.(\d+)\]/i);
  const minMatch = output.match(/\bMin:\s*(\d+)/i);
  const maxMatch = output.match(/\bMax:\s*(\d+)/i);
  const current = volumeMatch
    ? Number(volumeMatch[1])
    : Number(currentLine?.[2] ?? currentLine?.[1]);
  const min = Number(rangeMatch?.[1] ?? minMatch?.[1]);
  const max = Number(rangeMatch?.[2] ?? maxMatch?.[1]);
  if (![current, min, max].every(Number.isFinite) || max <= min)
    return undefined;
  return { current, min, max };
};

export const parseFireTvAudioDumpVolume = (output: string) => {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((line) => /\bSTREAM_MUSIC\b/.test(line));
  if (start < 0) return undefined;
  return parseVolumeInfo(lines.slice(start, start + 20).join('\n'));
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

const readFireTvVolume = async (host: string) => {
  const volumeCommands = [
    ['shell', 'cmd', 'media_session', 'volume'],
    ['shell', 'media', 'volume'],
  ];
  const diagnostics: string[] = [];
  for (const command of volumeCommands) {
    try {
      const result = await runAdb(host, [
        ...command,
        '--stream',
        MUSIC_STREAM,
        '--get',
      ]);
      const output = result.stdout + '\n' + result.stderr;
      const volume = parseVolumeInfo(output);
      if (volume) return { volume, command };
      diagnostics.push(output.trim());
    } catch (error) {
      diagnostics.push(error instanceof Error ? error.message : String(error));
    }
  }
  try {
    const result = await runAdb(host, ['shell', 'dumpsys', 'audio']);
    const output = result.stdout + '\n' + result.stderr;
    const volume = parseFireTvAudioDumpVolume(output);
    if (volume) return { volume, diagnostics };
    diagnostics.push(output.slice(0, 1200).trim());
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : String(error));
  }
  console.warn(
    '[FIRE_TV_VOLUME] Could not read STREAM_MUSIC volume:',
    diagnostics.join(' | ').slice(0, 2500),
  );
  return undefined;
};

const setFireTvVolumePercent = async (host: string, percent: number) => {
  let state = await readFireTvVolume(host);
  if (!state) throw new Error('Не удалось определить диапазон громкости Fire TV.');

  const { min, max } = state.volume;
  const target = volumeIndexForPercent(min, max, percent);
  const volumeCommands = [
    ...('command' in state ? [state.command] : []),
    ['shell', 'cmd', 'media_session', 'volume'],
    ['shell', 'media', 'volume'],
  ];
  for (const command of volumeCommands) {
    try {
      await runAdb(host, [
        ...command,
        '--show',
        '--stream',
        MUSIC_STREAM,
        '--set',
        String(target),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const check = await readFireTvVolume(host);
      if (check?.volume.current === target) return;
      if (check) state = check;
    } catch {
      // Try another setter before falling back to remote volume key events.
    }
  }

  const key =
    target > state.volume.current ? 'KEYCODE_VOLUME_UP' : 'KEYCODE_VOLUME_DOWN';
  const steps = Math.abs(target - state.volume.current);
  if (steps > 0)
    await runAdb(host, [
      'shell',
      'input',
      'keyevent',
      ...Array.from({ length: steps }, () => key),
    ]);
};

export const assertFireTvActivityStarted = (output: string) => {
  if (
    /(?:Activity not started|SecurityException|unable to resolve Intent|No Activity found)/i.test(
      output,
    )
  )
    throw new Error('Телевизор не смог открыть видео через ADB.');
};

const isYoutubeForeground = async (host: string) => {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  try {
    const result = await runAdb(host, [
      'shell',
      'dumpsys',
      'activity',
      'activities',
    ]);
    return /com\.amazon\.firetv\.youtube|com\.google\.android\.youtube\.tv/i.test(
      result.stdout,
    );
  } catch {
    return false;
  }
};

const startVideo = async (host: string, url: string, packageName?: string) => {
  const args = [
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    ...(packageName ? ['-p', packageName] : []),
    '-d',
    url,
  ];
  let result: Awaited<ReturnType<typeof runAdb>>;
  try {
    result = await runAdb(host, args);
  } catch (error) {
    if (await isYoutubeForeground(host)) return;
    throw error;
  }
  try {
    assertFireTvActivityStarted(result.stdout + '\n' + result.stderr);
  } catch (error) {
    if (await isYoutubeForeground(host)) return;
    throw error;
  }
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
  try {
    await setFireTvVolumePercent(host, FIRE_TV_VOLUME_PERCENT);
  } catch (error) {
    console.warn('[FIRE_TV_VOLUME] Pre-playback volume set failed:', error);
  }
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
    } catch {
      // Some Fire OS versions have the app but do not export its URL handler.
      await startVideo(host, watchUrl);
    }
  } else {
    await startVideo(host, watchUrl);
  }

  // YouTube can restore the previous audio level when its media session starts.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try {
    await setFireTvVolumePercent(host, FIRE_TV_VOLUME_PERCENT);
  } catch (error) {
    console.warn('[FIRE_TV_VOLUME] Post-playback volume set failed:', error);
  }
  return url;
};
