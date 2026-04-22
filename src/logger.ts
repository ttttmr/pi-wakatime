import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export enum LogLevel {
  DEBUG = 0,
  INFO,
  WARN,
  ERROR,
}

const LOG_FILE = path.join(os.homedir(), '.wakatime', 'pi-wakatime.log');

export class Logger {
  private level: LogLevel = LogLevel.INFO;

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  public getLevel(): LogLevel {
    return this.level;
  }

  public log(level: LogLevel, message: string): void {
    if (level < this.level) return;

    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}][${LogLevel[level]}] ${message}\n`);
  }

  public debug(message: string): void {
    this.log(LogLevel.DEBUG, message);
  }

  public info(message: string): void {
    this.log(LogLevel.INFO, message);
  }

  public warn(message: string): void {
    this.log(LogLevel.WARN, message);
  }

  public error(message: string): void {
    this.log(LogLevel.ERROR, message);
  }

  public debugException(error: unknown): void {
    this.debug(this.formatError(error));
  }

  public warnException(error: unknown): void {
    this.warn(this.formatError(error));
  }

  public errorException(error: unknown): void {
    this.error(this.formatError(error));
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}

const globalLogger = globalThis as unknown as { logger?: Logger };

export const logger = globalLogger.logger ?? new Logger();
globalLogger.logger = logger;
