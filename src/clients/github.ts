import type { Octokit } from '@octokit/rest';

import logger from '../core/logger.js';
import { profileFilePath } from '../services/userScope.js';

const getErrorStatus = (error: unknown): number | undefined =>
  error instanceof Error && 'status' in error
    ? (error as { status: number }).status
    : undefined;

// Singleton Octokit instance
let octokitInstance: Octokit | null = null;

export const getOctokit = async (): Promise<Octokit> => {
  if (!process.env.PROVIDER_API_KEY) {
    throw new Error('PROVIDER_API_KEY is not configured');
  }

  if (!octokitInstance) {
    const { Octokit } = await import('@octokit/rest');
    octokitInstance = new Octokit({
      auth: process.env.PROVIDER_API_KEY,
    });
  }

  return octokitInstance;
};

const FILE_PATH_PATTERN = /github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/;

interface GitHubFileInfo {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
}
const parseGitHubPath = (path: string): GitHubFileInfo => {
  const match = path.match(FILE_PATH_PATTERN);
  if (!match) {
    throw new Error(
      'FILE_PATH format is invalid. Expected format: https://github.com/owner/repo/blob/branch/path/to/file',
    );
  }

  const [, owner, repo, branch, filePath] = match;
  return {
    owner,
    repo,
    branch,
    filePath: decodeURIComponent(filePath),
  };
};

export const getGitHubFileInfo = (): GitHubFileInfo => {
  const path = process.env.FILE_PATH;
  if (!path) {
    throw new Error('FILE_PATH is not configured');
  }

  const info = parseGitHubPath(path);
  return { ...info, filePath: profileFilePath(info.filePath) };
};

export const fetchFileContent = async (): Promise<string> => {
  const { owner, repo, branch, filePath } = getGitHubFileInfo();
  try {
    const octokit = await getOctokit();

    const res = await octokit.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: branch,
    });

    if (Array.isArray(res.data) || res.data.type !== 'file') {
      throw new Error('Path is not a file');
    }

    const base64 = res.data.content.replace(/\n/g, '');
    const text = Buffer.from(base64, 'base64').toString('utf8');

    return text;
  } catch (error) {
    if (getErrorStatus(error) === 404) {
      const notFoundErrorMsg =
        'Tasks file not found. Make sure the file exists in the repository.';
      logger.errorWithContext({
        userId: owner,
        op: 'FETCH_FILE',
        error: notFoundErrorMsg,
      });
      throw new Error(notFoundErrorMsg);
    }
    const errorMsg =
      error instanceof Error ? error.message : JSON.stringify(error);
    logger.errorWithContext({
      userId: owner,
      op: 'FETCH_FILE',
      error: errorMsg,
    });
    throw new Error(`Failed to fetch file from GitHub: ${errorMsg}`);
  }
};

export const saveFileContent = async (
  content: string,
  commitMessage: string,
  retries = 3,
): Promise<boolean> => {
  let attempt = 0;
  const { owner, repo, branch, filePath } = getGitHubFileInfo();
  while (attempt < retries) {
    try {
      const octokit = await getOctokit();

      let sha: string | undefined;

      // Try to get current file SHA (required for update)
      try {
        const currentFile = await octokit.repos.getContent({
          owner,
          repo,
          path: filePath,
          ref: branch,
        });

        if (
          Array.isArray(currentFile.data) ||
          currentFile.data.type !== 'file'
        ) {
          throw new Error('Path is not a file');
        }

        sha = currentFile.data.sha;
      } catch (error) {
        const status = getErrorStatus(error);

        // If file doesn't exist (404) or repo is empty (404), we'll create it without SHA
        if (status === 404) {
          logger.infoWithContext({
            userId: owner,
            op: 'SAVE_FILE',
            message: 'File does not exist, creating new file',
          });
          sha = undefined;
        } else {
          throw error;
        }
      }

      // Create or update file on GitHub
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: commitMessage,
        content: Buffer.from(content).toString('base64'),
        ...(sha && { sha }), // Only include sha if it exists
        branch,
      });

      logger.infoWithContext({ message: `File saved to GitHub: ${filePath}` });
      return true;
    } catch (error) {
      attempt++;
      const isConflict = getErrorStatus(error) === 409;

      if (isConflict && attempt < retries) {
        logger.warnWithContext({
          userId: owner,
          op: 'SAVE_FILE',
          error: `GitHub conflict (409) detected on attempt ${attempt}. Retrying...`,
        });
        // Wait a bit before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        continue;
      }

      const errorMsg =
        error instanceof Error ? error.message : JSON.stringify(error);
      logger.errorWithContext({
        userId: owner,
        op: 'SAVE_FILE',
        error: `GitHub save error (Attempt ${attempt}): ${errorMsg}`,
      });

      if (attempt >= retries) {
        logger.errorWithContext({
          userId: owner,
          op: 'SAVE_FILE',
          error: `Failed after ${retries} attempts: ${errorMsg}`,
        });
        throw new Error(
          `Failed to save file to GitHub after ${retries} attempts: ${errorMsg}`,
        );
      }
    }
  }
  return false;
};
