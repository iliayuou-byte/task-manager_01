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
  volumeIndexForPercent,
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

test('volume percentage maps to the device range', () => {
  expect(volumeIndexForPercent(0, 15, 35)).toBe(5);
  expect(volumeIndexForPercent(0, 25, 35)).toBe(9);
  expect(() => volumeIndexForPercent(0, 15, 110)).toThrow();
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

test('ADB reports explicit launch errors even when its exit code is zero', () => {
  expect(() =>
    assertFireTvActivityStarted(
      'Error: Activity not started, unable to resolve Intent',
    ),
  ).toThrow('не смог открыть видео');
  expect(() => assertFireTvActivityStarted('Status: ok')).not.toThrow();
  // Activity Manager can report a readiness timeout after dispatching the
  // intent, while YouTube still opens successfully on Fire TV.
  expect(() =>
    assertFireTvActivityStarted('Status: timeout\nStarting: Intent { ... }'),
  ).not.toThrow();
});

const integrationTest = process.platform === 'win32' ? test.skip : test;
integrationTest(
  'wake sets volume to 35%, launches a video, and adjusts volume after playback starts',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fire-tv-adb-'));
    const adb = join(directory, 'adb');
    const log = join(directory, 'commands.txt');
    const previousAdb = process.env.FIRE_TV_ADB_PATH;
    const previousLog = process.env.FIRE_TV_TEST_LOG;
    writeFileSync(
      adb,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FIRE_TV_TEST_LOG"\ncase "$*" in\n  *"volume --stream 3 --get"*) echo "[V] volume is 6 in range [0..15]" ;;\n  *"pm path"*) echo "package:/data/app/youtube.apk" ;;\n  *"-p com.amazon.firetv.youtube"*) echo "Error: Activity not started" ;;\n  *"am start"*) echo "Status: timeout" ;;\nesac\n',
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
        'cmd media_session volume --show --stream 3 --set 5',
      );
      expect(commands).toContain(
        'android.intent.action.VIEW -d https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      );
      expect(commands).toContain('KEYCODE_VOLUME_DOWN');
      expect(commands).not.toContain('am start -W');
      const commandLines = commands.split(/\r?\n/);
      const startIndex = commandLines.findIndex(
        (line) =>
          line.includes('am start') &&
          line.includes('android.intent.action.VIEW') &&
          !line.includes('-p com.amazon.firetv.youtube'),
      );
      const lastVolumeAdjustIndex = commandLines.reduce(
        (last, line, index) =>
          line.includes('KEYCODE_VOLUME_DOWN') ? index : last,
        -1,
      );
      expect(lastVolumeAdjustIndex).toBeGreaterThan(startIndex);
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
