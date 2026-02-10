import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as child_process from 'node:child_process';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import AdmZip from 'adm-zip';

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/wakatime/wakatime-cli/releases/latest';
const GITHUB_DOWNLOAD_URL = 'https://github.com/wakatime/wakatime-cli/releases/latest/download';

// Minimum version required to support the "ai coding" category (added in v1.118.0).
// Any binary older than this will be replaced with the latest download.
const MIN_VERSION = [1, 118, 0];

/**
 * Parse a wakatime-cli version string like "v1.118.0" into [major, minor, patch].
 * Returns null if the string cannot be parsed.
 */
function parseVersion(raw: string): [number, number, number] | null {
  const match = raw.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

/**
 * Returns true if `version` satisfies the minimum version requirement.
 */
function meetsMinimum(version: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (version[i] > MIN_VERSION[i]) return true;
    if (version[i] < MIN_VERSION[i]) return false;
  }
  return true; // equal
}

export class WakaTimeCli {
  private cliLocation: string | undefined;
  private installDir: string;

  constructor() {
    this.installDir = path.join(os.homedir(), '.wakatime');
    if (!fs.existsSync(this.installDir)) {
      fs.mkdirSync(this.installDir, { recursive: true });
    }
  }

  public getLocation(): string {
    if (this.cliLocation) return this.cliLocation;

    // Check global
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      const binary = `wakatime-cli${process.platform === 'win32' ? '.exe' : ''}`;
      const globalPath = child_process.execSync(`${cmd} ${binary}`).toString().split('\n')[0].trim();
      if (globalPath && fs.existsSync(globalPath)) {
        this.cliLocation = globalPath;
        return globalPath;
      }
    } catch (e) {
      // Ignore
    }

    // Check local
    const ext = process.platform === 'win32' ? '.exe' : '';
    const osName = this.getOsName();
    const arch = this.getArchitecture();
    const binaryName = `wakatime-cli-${osName}-${arch}${ext}`;
    const localPath = path.join(this.installDir, binaryName);

    // Also check standard name in install dir (renamed after download)
    const standardPath = path.join(this.installDir, `wakatime-cli${ext}`);

    if (fs.existsSync(standardPath)) {
      this.cliLocation = standardPath;
      return standardPath;
    }

    if (fs.existsSync(localPath)) {
      this.cliLocation = localPath;
      return localPath;
    }

    // Default to standard path for future installation
    return standardPath;
  }

  /**
   * Returns the version string reported by the binary at `location`,
   * or null if it cannot be determined.
   */
  private getInstalledVersion(location: string): string | null {
    try {
      return child_process.execSync(`"${location}" --version`, { timeout: 5000 }).toString().trim();
    } catch (e) {
      return null;
    }
  }

  public async checkAndInstall(): Promise<string> {
    const location = this.getLocation();

    if (!fs.existsSync(location)) {
      console.log('[WakaTime] Installing wakatime-cli...');
      await this.install();
      return this.getLocation();
    }

    // Binary exists — check its version meets the minimum requirement.
    const raw = this.getInstalledVersion(location);
    const version = raw ? parseVersion(raw) : null;

    if (!version) {
      console.log(`[WakaTime] Could not determine version of ${location}, re-installing...`);
      await this.install();
      return this.getLocation();
    }

    if (!meetsMinimum(version)) {
      console.log(
        `[WakaTime] wakatime-cli ${raw} is below minimum required v${MIN_VERSION.join('.')} — updating...`
      );
      await this.install();
      return this.getLocation();
    }

    return location;
  }

  private async install(): Promise<void> {
    const osName = this.getOsName();
    const arch = this.getArchitecture();
    const url = `${GITHUB_DOWNLOAD_URL}/wakatime-cli-${osName}-${arch}.zip`;
    const zipPath = path.join(this.installDir, `wakatime-cli-temp.zip`);

    await this.downloadFile(url, zipPath);

    console.log('[WakaTime] Extracting...');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(this.installDir, true);
    
    fs.unlinkSync(zipPath);

    // Find extracted file and rename/link
    const ext = process.platform === 'win32' ? '.exe' : '';
    const extractedName = `wakatime-cli-${osName}-${arch}${ext}`;
    const extractedPath = path.join(this.installDir, extractedName);
    const targetPath = path.join(this.installDir, `wakatime-cli${ext}`);

    if (fs.existsSync(extractedPath)) {
        // If the zip contained the long name
        fs.renameSync(extractedPath, targetPath);
    } 
    
    if (process.platform !== 'win32') {
        fs.chmodSync(targetPath, 0o755);
    }
    
    // Clear cached location so getLocation() re-evaluates after install
    this.cliLocation = undefined;
    console.log(`[WakaTime] Installed to ${targetPath}`);
  }

  private async downloadFile(url: string, dest: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${url}: ${res.statusText}`);
    const stream = fs.createWriteStream(dest);
    // @ts-ignore
    await finished(Readable.fromWeb(res.body).pipe(stream));
  }

  private getOsName(): string {
    if (process.platform === 'win32') return 'windows';
    return process.platform;
  }

  private getArchitecture(): string {
    const arch = os.arch();
    if (arch.indexOf('32') > -1) return '386';
    if (arch.indexOf('x64') > -1) return 'amd64';
    return arch;
  }
}
