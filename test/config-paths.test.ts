import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getHomeDirectory } from '../src/utils.ts';

test('getHomeDirectory returns WAKATIME_HOME even when the directory does not exist yet', () => {
  const previousWakatimeHome = process.env.WAKATIME_HOME;
  const previousHome = process.env.HOME;
  const configuredHome = path.join(os.tmpdir(), `pi-wakatime-home-${Date.now()}`, 'missing');

  try {
    process.env.WAKATIME_HOME = configuredHome;
    process.env.HOME = path.join(os.tmpdir(), 'regular-home');

    assert.equal(getHomeDirectory(), configuredHome);
  } finally {
    if (previousWakatimeHome === undefined) {
      delete process.env.WAKATIME_HOME;
    } else {
      process.env.WAKATIME_HOME = previousWakatimeHome;
    }

    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
});

test('default heartbeat state directory follows WAKATIME_HOME', async () => {
  const previousWakatimeHome = process.env.WAKATIME_HOME;
  const wakatimeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-wakatime-home-'));

  try {
    process.env.WAKATIME_HOME = wakatimeHome;
    const { getStateFilePath } = await import(`../src/heartbeat.ts?state-dir=${Date.now()}`);

    assert.equal(
      getStateFilePath('session-id'),
      path.join(wakatimeHome, '.wakatime', 'pi-wakatime-state', 'session-id.json'),
    );
  } finally {
    if (previousWakatimeHome === undefined) {
      delete process.env.WAKATIME_HOME;
    } else {
      process.env.WAKATIME_HOME = previousWakatimeHome;
    }
    fs.rmSync(wakatimeHome, { recursive: true, force: true });
  }
});

test('heartbeat tracker persists throttle state under WAKATIME_HOME', async () => {
  const previousWakatimeHome = process.env.WAKATIME_HOME;
  const wakatimeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-wakatime-home-'));

  try {
    process.env.WAKATIME_HOME = wakatimeHome;
    const { HeartbeatTracker } = await import(`../src/heartbeat.ts?tracker-state=${Date.now()}`);
    const tracker = new HeartbeatTracker({
      dependencies: {
        getCliLocation: () => '/bin/echo',
        checkAndInstallCli: async () => '/bin/echo',
      },
      plugin: 'test-plugin',
      execFile: (_file, _args, _options, callback) => callback(null, '', ''),
      now: () => 123,
    });

    tracker.track({
      type: 'session',
      entity: path.join(wakatimeHome, 'project', '.pi-session'),
      projectFolder: path.join(wakatimeHome, 'project'),
      category: 'coding',
      stateKey: 'session-id',
      sourceEvent: 'UserPromptSubmit',
    });
    await new Promise((resolve) => setImmediate(resolve));

    const stateFile = path.join(wakatimeHome, '.wakatime', 'pi-wakatime-state', 'session-id.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf-8')), { lastHeartbeatAt: 123 });
  } finally {
    if (previousWakatimeHome === undefined) {
      delete process.env.WAKATIME_HOME;
    } else {
      process.env.WAKATIME_HOME = previousWakatimeHome;
    }
    fs.rmSync(wakatimeHome, { recursive: true, force: true });
  }
});

test('logger writes extension logs under WAKATIME_HOME', async () => {
  const previousWakatimeHome = process.env.WAKATIME_HOME;
  const wakatimeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-wakatime-home-'));

  try {
    process.env.WAKATIME_HOME = wakatimeHome;
    const { Logger, LogLevel } = await import(`../src/logger.ts?log-file=${Date.now()}`);
    const logger = new Logger();

    logger.setLevel(LogLevel.DEBUG);
    logger.info('hello from test');

    const logFile = path.join(wakatimeHome, '.wakatime', 'pi-wakatime.log');
    assert.match(fs.readFileSync(logFile, 'utf-8'), /hello from test/);
  } finally {
    if (previousWakatimeHome === undefined) {
      delete process.env.WAKATIME_HOME;
    } else {
      process.env.WAKATIME_HOME = previousWakatimeHome;
    }
    fs.rmSync(wakatimeHome, { recursive: true, force: true });
  }
});
