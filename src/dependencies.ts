import AdmZip from 'adm-zip';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import tls from 'node:tls';
import type { Logger } from './logger';
import type { Options } from './options';
import { buildExecOptions, isWindows } from './utils';

export class Dependencies {
  private options: Options;
  private logger: Logger;
  private resourcesLocation: string;
  private cliLocation?: string;
  private cliLocationGlobal?: string;
  private githubDownloadUrl = 'https://github.com/wakatime/wakatime-cli/releases/latest/download';
  private githubReleasesUrl = 'https://api.github.com/repos/wakatime/wakatime-cli/releases/latest';

  constructor(options: Options, logger: Logger) {
    this.options = options;
    this.logger = logger;
    this.resourcesLocation = options.resourcesLocation;
  }

  public getCliLocation(): string {
    if (this.cliLocation) return this.cliLocation;

    const globalLocation = this.getCliLocationGlobal();
    if (globalLocation) {
      this.cliLocation = globalLocation;
      return globalLocation;
    }

    const ext = isWindows() ? '.exe' : '';
    const binary = `wakatime-cli-${this.osName()}-${this.architecture()}${ext}`;
    const preferred = path.join(this.resourcesLocation, `wakatime-cli${ext}`);
    const extracted = path.join(this.resourcesLocation, binary);

    if (fs.existsSync(preferred)) {
      this.cliLocation = preferred;
      return preferred;
    }

    this.cliLocation = extracted;
    return extracted;
  }

  public getCliLocationGlobal(): string | undefined {
    if (this.cliLocationGlobal) return this.cliLocationGlobal;

    const binary = `wakatime-cli${isWindows() ? '.exe' : ''}`;
    const command = isWindows() ? 'where' : 'which';
    const result = childProcess.spawnSync(command, [binary], {
      ...buildExecOptions(),
      encoding: 'utf-8',
    });

    if (result.status === 0) {
      const location = String(result.stdout || '').split(/\r?\n/).find(Boolean)?.trim();
      if (location) {
        this.logger.debug(`Using global wakatime-cli location: ${location}`);
        this.cliLocationGlobal = location;
      }
    }

    return this.cliLocationGlobal;
  }

  public async checkAndInstallCli(): Promise<string> {
    const location = this.getCliLocation();

    if (!fs.existsSync(location)) {
      await this.installCli();
      return this.getCliLocation();
    }

    if (this.getCliLocationGlobal()) {
      return location;
    }

    const isLatest = await this.isCliLatest();
    if (!isLatest) {
      try {
        await this.installCli();
      } catch (error) {
        this.logger.warn(`Unable to update wakatime-cli, keeping existing binary: ${String(error)}`);
      }
    }

    return this.getCliLocation();
  }

  private async isCliLatest(): Promise<boolean> {
    const currentVersion = await this.getInstalledCliVersion();
    if (!currentVersion) return false;
    if (currentVersion === '<local-build>') return true;

    const lastAccessed = parseInt(this.options.getSetting('internal', 'cli_version_last_accessed', true) || '0', 10);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (lastAccessed && nowSeconds - lastAccessed < 4 * 3600) {
      this.logger.debug('Skipping wakatime-cli update check because it was checked recently.');
      return true;
    }

    const latestVersion = await this.getLatestCliVersion();
    if (!latestVersion) return true;

    this.options.setSetting('internal', 'cli_version_last_accessed', String(nowSeconds), true);
    return currentVersion === latestVersion;
  }

  private async getInstalledCliVersion(): Promise<string | undefined> {
    const cli = this.getCliLocation();
    if (!fs.existsSync(cli)) return undefined;

    const options = buildExecOptions();
    return await new Promise((resolve) => {
      childProcess.execFile(cli, ['--version'], options, (error, stdout, stderr) => {
        if (error) {
          resolve(undefined);
          return;
        }
        const version = `${stdout}${stderr}`.trim();
        this.logger.debug(`Current wakatime-cli version is ${version}`);
        resolve(version || undefined);
      });
    });
  }

  private async getLatestCliVersion(): Promise<string | undefined> {
    const proxy = this.options.getSetting('settings', 'proxy');
    const noSSLVerify = this.options.getSetting('settings', 'no_ssl_verify') === 'true';

    try {
      const { statusCode, body } = await this.getJson(this.githubReleasesUrl, {
        headers: this.getRequestHeaders(),
        proxy: proxy || undefined,
        noSSLVerify,
      });
      if (statusCode !== 200) {
        this.logger.warn(`GitHub releases API returned ${statusCode}`);
        return undefined;
      }
      return body.tag_name as string | undefined;
    } catch (error) {
      this.logger.warn(`Unable to check latest wakatime-cli version: ${String(error)}`);
      return undefined;
    }
  }

  private async installCli(): Promise<void> {
    const ext = isWindows() ? '.exe' : '';
    const archivePath = path.join(this.resourcesLocation, `wakatime-cli-${Date.now()}.zip`);
    const binary = `wakatime-cli-${this.osName()}-${this.architecture()}${ext}`;
    const downloadedTarget = path.join(this.resourcesLocation, binary);
    const preferredTarget = path.join(this.resourcesLocation, `wakatime-cli${ext}`);
    const proxy = this.options.getSetting('settings', 'proxy');
    const noSSLVerify = this.options.getSetting('settings', 'no_ssl_verify') === 'true';

    this.logger.info(`Downloading wakatime-cli from ${this.cliDownloadUrl()}`);

    await this.downloadToFile(this.cliDownloadUrl(), archivePath, {
      headers: this.getRequestHeaders(),
      proxy: proxy || undefined,
      noSSLVerify,
    });

    const backupTarget = fs.existsSync(preferredTarget) ? `${preferredTarget}.backup` : undefined;
    if (backupTarget && fs.existsSync(preferredTarget)) {
      fs.renameSync(preferredTarget, backupTarget);
    }

    try {
      const zip = new AdmZip(archivePath);
      zip.extractAllTo(this.resourcesLocation, true);
      if (!fs.existsSync(downloadedTarget) && fs.existsSync(preferredTarget)) {
        this.cliLocation = preferredTarget;
      } else if (fs.existsSync(downloadedTarget)) {
        if (fs.existsSync(preferredTarget)) {
          fs.rmSync(preferredTarget, { force: true });
        }
        fs.renameSync(downloadedTarget, preferredTarget);
        this.cliLocation = preferredTarget;
      }

      if (!isWindows() && fs.existsSync(preferredTarget)) {
        fs.chmodSync(preferredTarget, 0o755);
      }

      if (backupTarget && fs.existsSync(backupTarget)) {
        fs.rmSync(backupTarget, { force: true });
      }
    } catch (error) {
      if (backupTarget && fs.existsSync(backupTarget)) {
        fs.renameSync(backupTarget, preferredTarget);
      }
      throw error;
    } finally {
      fs.rmSync(archivePath, { force: true });
    }
  }

  private cliDownloadUrl(): string {
    return `${this.githubDownloadUrl}/wakatime-cli-${this.osName()}-${this.architecture()}.zip`;
  }

  private architecture(): string {
    const arch = os.arch();
    if (arch.includes('32')) return '386';
    if (arch.includes('x64')) return 'amd64';
    return arch;
  }

  private osName(): string {
    return process.platform === 'win32' ? 'windows' : process.platform;
  }

  private getRequestHeaders(): Record<string, string> {
    return {
      'User-Agent': 'github.com/ttttmr/pi-wakatime',
    };
  }

  private async getJson(
    url: string,
    options?: { headers?: Record<string, string>; proxy?: string; noSSLVerify?: boolean },
  ): Promise<{ statusCode: number; body: Record<string, unknown> }> {
    const response = await this.requestWithRedirects(url, options);
    const statusCode = response.statusCode ?? 0;
    const chunks: Buffer[] = [];

    for await (const chunk of response) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }

    const content = Buffer.concat(chunks).toString('utf-8');
    return {
      statusCode,
      body: content ? (JSON.parse(content) as Record<string, unknown>) : {},
    };
  }

  private async downloadToFile(
    url: string,
    outputFile: string,
    options?: { headers?: Record<string, string>; proxy?: string; noSSLVerify?: boolean },
  ): Promise<void> {
    const response = await this.requestWithRedirects(url, options);
    const statusCode = response.statusCode ?? 0;
    if (statusCode < 200 || statusCode >= 300) {
      response.resume();
      throw new Error(`Unexpected status code ${statusCode}`);
    }
    await pipeline(response, fs.createWriteStream(outputFile));
  }

  private async requestWithRedirects(
    url: string,
    options?: { headers?: Record<string, string>; proxy?: string; noSSLVerify?: boolean },
    redirectsLeft = 5,
  ): Promise<http.IncomingMessage> {
    const response = await this.sendRequest(url, options);
    const statusCode = response.statusCode ?? 0;
    const location = response.headers.location;

    if (statusCode >= 300 && statusCode < 400 && location && redirectsLeft > 0) {
      response.resume();
      const nextUrl = new URL(location, url).toString();
      return this.requestWithRedirects(nextUrl, options, redirectsLeft - 1);
    }

    return response;
  }

  private async sendRequest(
    url: string,
    options?: { headers?: Record<string, string>; proxy?: string; noSSLVerify?: boolean },
  ): Promise<http.IncomingMessage> {
    const targetUrl = new URL(url);
    const proxyUrl = options?.proxy ? new URL(options.proxy) : undefined;
    const headers = { ...(options?.headers || {}) };
    const rejectUnauthorized = !options?.noSSLVerify;

    return await new Promise<http.IncomingMessage>(async (resolve, reject) => {
      let request: http.ClientRequest | undefined;

      try {
        if (proxyUrl && targetUrl.protocol === 'https:') {
          const tunnel = await this.createProxyTunnel(proxyUrl, targetUrl, rejectUnauthorized);
          const secureSocket = tls.connect({
            socket: tunnel,
            servername: targetUrl.hostname,
            rejectUnauthorized,
          });

          secureSocket.once('error', reject);
          request = https.request(
            {
              host: targetUrl.hostname,
              port: targetUrl.port ? parseInt(targetUrl.port, 10) : 443,
              path: `${targetUrl.pathname}${targetUrl.search}`,
              method: 'GET',
              headers,
              agent: false,
              createConnection: () => secureSocket,
            },
            resolve,
          );
        } else {
          const requestTarget = proxyUrl ?? targetUrl;
          const isHttpsRequest = requestTarget.protocol === 'https:';
          const requestModule = isHttpsRequest ? https : http;
          request = requestModule.request(
            {
              host: requestTarget.hostname,
              port: requestTarget.port ? parseInt(requestTarget.port, 10) : isHttpsRequest ? 443 : 80,
              path: proxyUrl ? targetUrl.toString() : `${targetUrl.pathname}${targetUrl.search}`,
              method: 'GET',
              headers: proxyUrl
                ? {
                    Host: targetUrl.host,
                    ...headers,
                    ...(this.getProxyAuthorizationHeader(proxyUrl)
                      ? { 'Proxy-Authorization': this.getProxyAuthorizationHeader(proxyUrl)! }
                      : {}),
                  }
                : headers,
              rejectUnauthorized,
              servername: requestTarget.hostname,
            },
            resolve,
          );
        }

        request.once('error', reject);
        request.end();
      } catch (error) {
        request?.destroy();
        reject(error);
      }
    });
  }

  private async createProxyTunnel(proxyUrl: URL, targetUrl: URL, rejectUnauthorized: boolean): Promise<net.Socket> {
    const proxyPort = proxyUrl.port ? parseInt(proxyUrl.port, 10) : proxyUrl.protocol === 'https:' ? 443 : 80;
    const socket =
      proxyUrl.protocol === 'https:'
        ? tls.connect({
            host: proxyUrl.hostname,
            port: proxyPort,
            rejectUnauthorized,
            servername: proxyUrl.hostname,
          })
        : net.connect(proxyPort, proxyUrl.hostname);

    return await new Promise<net.Socket>((resolve, reject) => {
      const auth = this.getProxyAuthorizationHeader(proxyUrl);
      let response = '';

      const cleanup = () => {
        socket.removeListener('error', onError);
        socket.removeListener('data', onData);
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const onData = (chunk: Buffer) => {
        response += chunk.toString('utf-8');
        if (!response.includes('\r\n\r\n')) return;

        cleanup();
        const statusLine = response.split('\r\n', 1)[0] || '';
        if (!statusLine.includes(' 200 ')) {
          socket.destroy();
          reject(new Error(`Proxy CONNECT failed: ${statusLine}`));
          return;
        }
        resolve(socket);
      };

      const request = [
        `CONNECT ${targetUrl.hostname}:${targetUrl.port || 443} HTTP/1.1`,
        `Host: ${targetUrl.hostname}:${targetUrl.port || 443}`,
        auth ? `Proxy-Authorization: ${auth}` : '',
        'Connection: close',
        '',
        '',
      ].join('\r\n');

      socket.once('error', onError);
      socket.on('data', onData);

      const writeRequest = () => socket.write(request);
      if (proxyUrl.protocol === 'https:') {
        socket.once('secureConnect', writeRequest);
      } else {
        socket.once('connect', writeRequest);
      }
    });
  }

  private getProxyAuthorizationHeader(proxyUrl: URL): string | undefined {
    if (!proxyUrl.username && !proxyUrl.password) return undefined;
    return `Basic ${Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString('base64')}`;
  }
}
