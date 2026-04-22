import fs from 'node:fs';
import path from 'node:path';
import { getHomeDirectory } from './utils';

export interface Setting {
  key: string;
  value: string;
}

export class Options {
  private configFile: string;
  private internalConfigFile: string;
  private logFile: string;
  public resourcesLocation: string;

  constructor() {
    const home = getHomeDirectory();
    const wakaFolder = path.join(home, '.wakatime');
    fs.mkdirSync(wakaFolder, { recursive: true });

    this.resourcesLocation = wakaFolder;
    this.configFile = path.join(home, '.wakatime.cfg');
    this.internalConfigFile = path.join(wakaFolder, 'wakatime-internal.cfg');
    this.logFile = path.join(wakaFolder, 'pi-wakatime.log');
  }

  public getSetting(section: string, key: string, internal = false): string | undefined {
    try {
      const content = fs.readFileSync(this.getConfigFile(internal), 'utf-8');
      return this.readIniValue(content, section, key);
    } catch {
      return undefined;
    }
  }

  public setSetting(section: string, key: string, value: string, internal = false): void {
    const current = this.readConfig(internal);
    const next = this.upsertSettings(current, section, [{ key, value }]);
    fs.writeFileSync(this.getConfigFile(internal), next);
  }

  public setSettings(section: string, settings: Setting[], internal = false): void {
    const current = this.readConfig(internal);
    const next = this.upsertSettings(current, section, settings);
    fs.writeFileSync(this.getConfigFile(internal), next);
  }

  public getConfigFile(internal = false): string {
    return internal ? this.internalConfigFile : this.configFile;
  }

  public getLogFile(): string {
    return this.logFile;
  }

  private readConfig(internal: boolean): string {
    try {
      return fs.readFileSync(this.getConfigFile(internal), 'utf-8');
    } catch {
      return '';
    }
  }

  private readIniValue(content: string, wantedSection: string, wantedKey: string): string | undefined {
    let currentSection = '';
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith(';') || line.startsWith('#')) continue;
      if (line.startsWith('[') && line.endsWith(']')) {
        currentSection = line.slice(1, -1).trim().toLowerCase();
        continue;
      }
      if (currentSection !== wantedSection.toLowerCase()) continue;
      const separator = line.indexOf('=');
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      if (key !== wantedKey) continue;
      return line.slice(separator + 1).trim().replace(/\0/g, '');
    }
    return undefined;
  }

  private upsertSettings(content: string, wantedSection: string, settings: Setting[]): string {
    const lines = content ? content.split(/\r?\n/) : [];
    const output: string[] = [];
    let currentSection = '';
    const inserted = new Set<string>();

    for (const rawLine of lines) {
      const line = rawLine.replace(/\0/g, '');
      const trimmed = line.trim();

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        if (currentSection === wantedSection.toLowerCase()) {
          for (const setting of settings) {
            if (!inserted.has(setting.key)) {
              output.push(`${setting.key} = ${setting.value}`);
              inserted.add(setting.key);
            }
          }
        }

        currentSection = trimmed.slice(1, -1).trim().toLowerCase();
        output.push(line);
        continue;
      }

      if (currentSection === wantedSection.toLowerCase()) {
        const separator = line.indexOf('=');
        if (separator !== -1) {
          const key = line.slice(0, separator).trim();
          const match = settings.find((setting) => setting.key === key);
          if (match) {
            if (!inserted.has(match.key)) {
              output.push(`${match.key} = ${match.value}`);
              inserted.add(match.key);
            }
            continue;
          }
        }
      }

      output.push(line);
    }

    if (currentSection !== wantedSection.toLowerCase()) {
      output.push(`[${wantedSection}]`);
    }

    for (const setting of settings) {
      if (!inserted.has(setting.key)) {
        output.push(`${setting.key} = ${setting.value}`);
      }
    }

    return output.filter((line, index, arr) => !(line === '' && arr[index - 1] === '')).join('\n');
  }
}
