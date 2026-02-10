import * as child_process from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { WakaTimeCli } from './cli';

const LOG_FILE = path.join(os.homedir(), '.wakatime', 'pi-wakatime.log');

function log(message: string) {
  const time = new Date().toISOString();
  try {
    fs.appendFileSync(LOG_FILE, `[${time}] ${message}\n`);
  } catch (e) {
    // ignore logging errors
  }
}

export class HeartbeatSender {
  private cli: WakaTimeCli;
  private lastHeartbeat: number = 0;
  private lastFile: string = "";
  private DEBOUNCE_TIME = 2000; // 2 seconds

  constructor() {
    this.cli = new WakaTimeCli();
  }

  public async init() {
    try {
      const location = await this.cli.checkAndInstall();
      log(`CLI ready: ${location}`);
    } catch (e: any) {
      log(`ERROR: CLI init failed - ${e.message}`);
      throw e;
    }
  }

  public send(
    file: string,
    params: {
      isWrite?: boolean;
      lineChanges?: number;
      projectRoot?: string;
      category?: string;
    }
  ) {
    const now = Date.now();
    
    // Special handling for .pi-session: always send to track active time
    const isSessionFile = file.endsWith('.pi-session');
    
    // Only debounce if it's the same file, NOT a write operation, and NOT .pi-session
    if (!params.isWrite && !isSessionFile && file === this.lastFile && now - this.lastHeartbeat < this.DEBOUNCE_TIME) {
        return;  // Silent debounce
    }

    const cliPath = this.cli.getLocation();
    if (!cliPath) {
      log('Error: CLI path not found when attempting to send heartbeat');
      return;
    }

    this.lastHeartbeat = now;
    this.lastFile = file;

    const args = [
      '--entity', file,
      '--entity-type', 'file',
      '--category', params.category || 'coding',
      '--plugin', 'pi-coding-agent/1.0.0 pi-wakatime/1.0.0',
    ];

    if (params.projectRoot) {
      args.push('--project-folder', params.projectRoot);
    }

    if (params.isWrite) {
      args.push('--write');
    }

    // Note: --ai-line-changes is not supported by wakatime-cli; category is already set above.

    // Run in background, don't await
    child_process.execFile(cliPath, args, (error, stdout, stderr) => {
      if (error) {
        log(`ERROR: ${path.basename(file)} - ${stderr || error.message}`);
        console.error('[WakaTime] Error sending heartbeat:', stderr || error.message);
      }
      // Success is silent
    });
  }
}
