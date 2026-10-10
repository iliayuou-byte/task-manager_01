import { expect, test } from 'bun:test';
import {
  normalizeFireTvHost,
  normalizeYoutubeUrl,
  parseFireTvMedia,
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
