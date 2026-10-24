import { expect, test } from 'bun:test';
import { MAX_VOICE_BYTES, readVoiceBytes } from './voiceDownload.js';

test('reads the actual audio bytes', async () => {
  const bytes = await readVoiceBytes(new Response(new Uint8Array([1, 2, 3])));
  expect(Array.from(bytes)).toEqual([1, 2, 3]);
});

test('rejects unsuccessful downloads', async () => {
  await expect(
    readVoiceBytes(new Response('', { status: 404 })),
  ).rejects.toThrow();
});

test('enforces the limit against actual bytes, not supplied metadata', async () => {
  await expect(
    readVoiceBytes(new Response(new Uint8Array(MAX_VOICE_BYTES + 1))),
  ).rejects.toThrow();
});
