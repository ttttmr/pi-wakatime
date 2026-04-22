import fs from 'node:fs';
import os from 'node:os';
import childProcess, { StdioOptions } from 'node:child_process';
import { createRequire } from 'node:module';
import type { EditBlock } from './types';

const require = createRequire(import.meta.url);

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function getHomeDirectory(): string {
  const configuredHome = process.env.WAKATIME_HOME;
  if (configuredHome && configuredHome.trim() && fs.existsSync(configuredHome.trim())) {
    return configuredHome.trim();
  }
  return process.env[isWindows() ? 'USERPROFILE' : 'HOME'] || os.homedir() || process.cwd();
}

export function buildExecOptions(stdin = false): childProcess.ExecFileOptions {
  const options: childProcess.ExecFileOptions = {
    windowsHide: true,
  };

  if (stdin) {
    (options as childProcess.ExecFileOptions & { stdio: StdioOptions }).stdio = ['pipe', 'pipe', 'pipe'];
  }

  if (!isWindows() && !process.env.WAKATIME_HOME && !process.env.HOME) {
    options.env = { ...process.env, WAKATIME_HOME: getHomeDirectory() };
  }

  return options;
}

export function formatArguments(binary: string, args: string[]): string {
  return [binary, ...args].map(wrapArgument).join(' ');
}

export function wrapArgument(arg: string): string {
  if (arg.includes(' ')) return `"${arg.replace(/"/g, '\\"')}"`;
  return arg;
}

export function countLines(content?: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

export function estimateWriteLineChanges(content?: string): number {
  return countLines(content);
}

export function estimateEditLineChanges(edits: EditBlock[]): number {
  return edits.reduce((total, edit) => {
    const oldLines = countLines(edit.oldText);
    const newLines = countLines(edit.newText);
    return total + Math.max(oldLines, newLines);
  }, 0);
}

export function getPackageVersion(packageName: string): string {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
    return packageJson.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

