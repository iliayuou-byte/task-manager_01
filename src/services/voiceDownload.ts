export const MAX_VOICE_BYTES = 8 * 1024 * 1024;
export const MAX_VOICE_SECONDS = 180;

export const readVoiceBytes = async (
  response: Response,
): Promise<Uint8Array> => {
  if (!response.ok || !response.body) throw new Error('Voice download failed');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_VOICE_BYTES) {
        await reader.cancel();
        throw new Error('Voice file exceeds size limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};
