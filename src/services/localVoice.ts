import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export class LocalVoiceError extends Error {
  constructor(public readonly code: 'setup' | 'failed' | 'timeout' | 'busy') {
    super(`Local voice: ${code}`);
    this.name = 'LocalVoiceError';
  }
}

let running = false;
export const localVoiceConfig = () => {
  const venv =
    process.platform === 'win32'
      ? '.venv/Scripts/python.exe'
      : '.venv/bin/python';
  return {
    python:
      process.env.WHISPER_PYTHON ||
      (existsSync(venv)
        ? venv
        : process.platform === 'win32'
          ? 'python'
          : 'python3'),
    script: fileURLToPath(
      new URL('../../scripts/transcribeVoice.py', import.meta.url),
    ),
  };
};

export const transcribeLocalVoice = async (
  audio: Uint8Array,
  config = localVoiceConfig(),
): Promise<string> => {
  if (running) throw new LocalVoiceError('busy');
  running = true;
  try {
    const { python, script } = config;
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(python, [script], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 240_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        output += chunk;
        if (output.length > 100_000) child.kill();
      });
      // Drain stderr; never log potentially sensitive subprocess output.
      child.stderr.resume();
      child.stdin.on('error', () => {
        /* Process exit handled below. */
      });
      child.once('error', () => {
        clearTimeout(timer);
        reject(new LocalVoiceError('setup'));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (timedOut) return reject(new LocalVoiceError('timeout'));
        if (code !== 0)
          return reject(new LocalVoiceError(code === 2 ? 'setup' : 'failed'));
        try {
          const result: unknown = JSON.parse(output);
          if (
            !result ||
            typeof result !== 'object' ||
            !('text' in result) ||
            typeof result.text !== 'string'
          )
            throw new Error('Invalid transcript');
          resolve(result.text.trim());
        } catch {
          reject(new LocalVoiceError('failed'));
        }
      });
      child.stdin.end(audio);
    });
  } finally {
    running = false;
  }
};
