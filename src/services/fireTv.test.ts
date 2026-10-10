import { expect, test } from 'bun:test';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertFireTvActivityStarted,
  normalizeFireTvHost,
  normalizeYoutubeUrl,
  parseFireTvMedia,
  wakeFireTv,
} from './fireTv.js';
import {
  deserializeTaskMarkdown,
  serializeTaskMarkdown,
} from './markdownParser.js';

test('Fire TV host accepts only private IPv4 addresses', () => {
  expect(normalizeFireTvHost('192.168.1.50')).toBe('192.168.1.50');
  expect(normalizeFireTvHost('10.0.0.7')).toBe('10.0.0.7');
  expect(() => normalizeFireTvHost('example.com')).toThrow();
  expect(() => normalizeFireTvHost('8.8.8.8')).toThrow();
  expect(() => normalizeFireTvHost('192.168.999.1')).toThrow();
});

test('YouTube links normalize to a safe video URL and deduplicate', () => {
  const url = 'https://youtu.be/dQw4w9WgXcQ?si=tracking';
  expect(normalizeYoutubeUrl(url)).toBe('https://youtu.be/dQw4w9WgXcQ');
  expect(
    parseFireTvMedia(
      `${url}\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30`,
    ),
  ).toEqual(['https://youtu.be/dQw4w9WgXcQ']);
  expect(() => normalizeYoutubeUrl('https://example.com/video')).toThrow();
});

test('TV settings survive Markdown frontmatter storage', () => {
  const markdown = serializeTaskMarkdown(
    { completed: [], uncompleted: [] },
    {
      fire_tv_host: '192.168.1.50',
      fire_tv_enabled: 'true',
      fire_tv_media: 'https://youtu.be/dQw4w9WgXcQ',
    },
  );
  expect(deserializeTaskMarkdown(markdown).metadata).toMatchObject({
    fire_tv_host: '192.168.1.50',
    fire_tv_enabled: 'true',
    fire_tv_media: 'https://youtu.be/dQw4w9WgXcQ',
  });
});

test('ADB reports launch errors even when its exit code is zero', () => {
  expect(() =>
    assertFireTvActivityStarted(
      'Error: Activity not started, unable to resolve Intent',
    ),
  ).toThrow('не смог открыть видео');
  expect(() => assertFireTvActivityStarted('Status: ok')).not.toThrow();
});

const integrationTest = process.platform === 'win32' ? test.skip : test;
integrationTest(
  'wake launches a saved video via the Fire TV app and falls back to an implicit intent',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fire-tv-adb-'));
    const adb = join(directory, 'adb');
    const log = join(directory, 'commands.txt');
    const previousAdb = process.env.FIRE_TV_ADB_PATH;
    const previousLog = process.env.FIRE_TV_TEST_LOG;
    writeFileSync(
      adb,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FIRE_TV_TEST_LOG"\ncase "$*" in\n  *"pm path"*) echo "package:/data/app/youtube.apk" ;;\n  *"-p com.amazon.firetv.youtube"*) echo "Error: Activity not started" ;;\n  *"am start"*) echo "Status: ok" ;;\nesac\n',
    );
    chmodSync(adb, 0o755);
    process.env.FIRE_TV_ADB_PATH = adb;
    process.env.FIRE_TV_TEST_LOG = log;
    try {
      const selected = await wakeFireTv('192.168.1.50', [
        'https://youtu.be/dQw4w9WgXcQ',
      ]);
      expect(selected).toBe('https://youtu.be/dQw4w9WgXcQ');
      const commands = readFileSync(log, 'utf8');
      expect(commands).toContain('KEYCODE_WAKEUP');
      expect(commands).toContain(
        '-p com.amazon.firetv.youtube -d https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      );
      expect(commands).toContain(
        'android.intent.action.VIEW -d https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      );
    } finally {
      if (previousAdb === undefined) delete process.env.FIRE_TV_ADB_PATH;
      else process.env.FIRE_TV_ADB_PATH = previousAdb;
      if (previousLog === undefined) delete process.env.FIRE_TV_TEST_LOG;
      else process.env.FIRE_TV_TEST_LOG = previousLog;
      rmSync(directory, { recursive: true, force: true });
    }
  },
  12_000,
);
