import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Dependencies } from './dependencies';
import { logger } from './logger';
import type { HeartbeatRequest, HeartbeatState } from './types';
import { estimateEditLineChanges } from './utils';

const DEFAULT_STATE_DIR = path.join(os.homedir(), '.wakatime', 'pi-wakatime-state');
export const SESSION_HEARTBEAT_INTERVAL_MS = 60_000;

export function getStateFilePath(stateKey: string, fallbackStateDir: string = DEFAULT_STATE_DIR): string {
  if (path.isAbsolute(stateKey) || stateKey.includes(path.sep)) {
    return `${stateKey}.wakatime`;
  }

  return path.join(fallbackStateDir, `${encodeURIComponent(stateKey)}.json`);
}

type ExecFileCallback = (error: childProcess.ExecFileException | null, stdout: string, stderr: string) => void;
type ExecFileFn = (file: string, args: readonly string[], callback: ExecFileCallback) => void;

type HeartbeatTrackerOptions = {
  dependencies: Pick<Dependencies, 'getCliLocation' | 'checkAndInstallCli'>;
  plugin: string;
  execFile?: ExecFileFn;
  now?: () => number;
  stateFile?: string;
};

type QueuedHeartbeat = {
  cliPath: string;
  args: string[];
  request: HeartbeatRequest;
};

export function shouldTrackTool(toolName: string): boolean {
  return toolName === 'read' || toolName === 'write' || toolName === 'edit';
}

export function shouldSendSessionHeartbeat(
  now: number,
  lastHeartbeatAt?: number,
  intervalMs: number = SESSION_HEARTBEAT_INTERVAL_MS,
): boolean {
  if (typeof lastHeartbeatAt !== 'number' || Number.isNaN(lastHeartbeatAt)) {
    return true;
  }

  return now - lastHeartbeatAt >= intervalMs;
}

export { estimateEditLineChanges };

export function buildHeartbeatArgs(input: {
  cliPath: string;
  plugin: string;
  request: HeartbeatRequest;
}): string[] {
  const { plugin, request } = input;
  const args = ['--entity', request.entity, '--entity-type', 'file', '--plugin', plugin];

  if (request.projectFolder) {
    args.push('--project-folder', request.projectFolder);
  }

  if (request.type === 'file' && request.isWrite) {
    args.push('--write');
  }

  if (request.type === 'file' && typeof request.lineChanges === 'number') {
    args.push('--category', 'ai coding', '--ai-line-changes', String(request.lineChanges));
    return args;
  }

  args.push('--category', request.category || 'coding');
  return args;
}

export class HeartbeatTracker {
  private dependencies: Pick<Dependencies, 'getCliLocation' | 'checkAndInstallCli'>;
  private plugin: string;
  private execFile: ExecFileFn;
  private now: () => number;
  private fallbackStateDir: string;
  private queue: QueuedHeartbeat[] = [];
  private processing = false;
  private sessionHeartbeatsInFlight = new Set<string>();

  constructor(options: HeartbeatTrackerOptions) {
    this.dependencies = options.dependencies;
    this.plugin = options.plugin;
    this.execFile = options.execFile || ((file, args, callback) => childProcess.execFile(file, args, callback));
    this.now = options.now || (() => Date.now());
    this.fallbackStateDir = options.stateFile || DEFAULT_STATE_DIR;
  }

  public async init(): Promise<string> {
    const location = await this.dependencies.checkAndInstallCli();
    logger.debug(`wakatime-cli ready at ${location}`);
    return location;
  }

  public track(request: HeartbeatRequest): void {
    if (request.type === 'session') {
      const lastHeartbeatAt = this.readState(this.getSessionStateFile(request.stateKey)).lastHeartbeatAt;
      if (!shouldSendSessionHeartbeat(this.now(), lastHeartbeatAt)) {
        return;
      }
      if (this.sessionHeartbeatsInFlight.has(request.stateKey)) {
        return;
      }
      this.sessionHeartbeatsInFlight.add(request.stateKey);
    }

    const cliPath = this.dependencies.getCliLocation();
    if (!cliPath) {
      if (request.type === 'session') {
        this.sessionHeartbeatsInFlight.delete(request.stateKey);
      }
      logger.warn('Skipping heartbeat because wakatime-cli is not available yet.');
      return;
    }

    this.queue.push({
      cliPath,
      args: buildHeartbeatArgs({ cliPath, plugin: this.plugin, request }),
      request,
    });

    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (!next) continue;
        await this.execute(next);
      }
    } finally {
      this.processing = false;
    }
  }

  private async execute(heartbeat: QueuedHeartbeat): Promise<void> {
    await new Promise<void>((resolve) => {
      this.execFile(heartbeat.cliPath, heartbeat.args, (error, stdout, stderr) => {
        if (heartbeat.request.type === 'session') {
          this.sessionHeartbeatsInFlight.delete(heartbeat.request.stateKey);
        }

        if (error) {
          logger.warn(`Heartbeat failed for ${path.basename(heartbeat.request.entity)}: ${stderr || error.message}`);
          resolve();
          return;
        }

        if (stdout.trim()) {
          logger.debug(stdout.trim());
        }
        if (stderr.trim()) {
          logger.warn(stderr.trim());
        }

        if (heartbeat.request.type === 'session') {
          this.updateSessionHeartbeatState(heartbeat.request.stateKey, this.now());
        }

        resolve();
      });
    });
  }

  private getSessionStateFile(sessionKey: string): string {
    return getStateFilePath(sessionKey, this.fallbackStateDir);
  }

  private readState(stateFile: string): HeartbeatState {
    try {
      if (!fs.existsSync(stateFile)) return {};
      return JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as HeartbeatState;
    } catch {
      return {};
    }
  }

  private updateSessionHeartbeatState(sessionKey: string, timestamp: number): void {
    const stateFile = this.getSessionStateFile(sessionKey);

    try {
      const next: HeartbeatState = {
        lastHeartbeatAt: timestamp,
      };
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify(next, null, 2));
    } catch (error) {
      logger.warn(`Unable to persist heartbeat state: ${String(error)}`);
    }
  }
}
