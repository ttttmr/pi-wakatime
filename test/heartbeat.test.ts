import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type childProcess from 'node:child_process';
import {
  buildHeartbeatArgs,
  HeartbeatTracker,
  shouldSendSessionHeartbeat,
  WAKATIME_CLI_TIMEOUT_MS,
} from '../src/heartbeat';
import type { HeartbeatRequest } from '../src/types';

test('buildHeartbeatArgs disables wakatime-cli AI transcript scanning for file heartbeats', () => {
  const args = buildHeartbeatArgs({
    cliPath: '/usr/local/bin/wakatime-cli',
    plugin: 'pi-coding-agent/test pi-wakatime/test',
    request: {
      type: 'file',
      entity: '/repo/src/index.ts',
      projectFolder: '/repo',
      category: 'coding',
    },
  });

  assert.ok(args.includes('--sync-ai-disabled'));
  assert.deepEqual(args.slice(0, 6), [
    '--entity', '/repo/src/index.ts',
    '--entity-type', 'file',
    '--plugin', 'pi-coding-agent/test pi-wakatime/test',
  ]);
  assert.deepEqual(args.slice(-2), ['--category', 'coding']);
});

test('buildHeartbeatArgs marks synthetic session heartbeats as unsaved entities', () => {
  const args = buildHeartbeatArgs({
    cliPath: '/usr/local/bin/wakatime-cli',
    plugin: 'pi-coding-agent/test pi-wakatime/test',
    request: {
      type: 'session',
      entity: '/repo/.pi-session',
      projectFolder: '/repo',
      category: 'coding',
      stateKey: 'session-id',
    },
  });

  assert.ok(args.includes('--sync-ai-disabled'));
  assert.ok(args.includes('--is-unsaved-entity'));
  assert.deepEqual(args.slice(-2), ['--category', 'coding']);
});

test('buildHeartbeatArgs preserves AI line change reporting for write heartbeats', () => {
  const args = buildHeartbeatArgs({
    cliPath: '/usr/local/bin/wakatime-cli',
    plugin: 'pi-coding-agent/test pi-wakatime/test',
    request: {
      type: 'file',
      entity: '/repo/src/index.ts',
      projectFolder: '/repo',
      category: 'coding',
      isWrite: true,
      lineChanges: 12,
    },
  });

  assert.ok(args.includes('--sync-ai-disabled'));
  assert.ok(args.includes('--write'));
  assert.deepEqual(args.slice(-4), ['--category', 'ai coding', '--ai-line-changes', '12']);
});

test('shouldSendSessionHeartbeat enforces the configured interval', () => {
  assert.equal(shouldSendSessionHeartbeat(1_000), true);
  assert.equal(shouldSendSessionHeartbeat(30_000, 0), false);
  assert.equal(shouldSendSessionHeartbeat(60_000, 0), true);
});

test('HeartbeatTracker passes timeout and kill signal to wakatime-cli execution', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-wakatime-test-'));
  const calls: Array<{ args: readonly string[]; options: childProcess.ExecFileOptions }> = [];
  const tracker = new HeartbeatTracker({
    dependencies: {
      getCliLocation: () => '/usr/local/bin/wakatime-cli',
      checkAndInstallCli: async () => '/usr/local/bin/wakatime-cli',
    },
    plugin: 'pi-coding-agent/test pi-wakatime/test',
    stateFile: tmp,
    execFile: (_file, args, options, callback) => {
      calls.push({ args, options });
      callback(null, '', '');
    },
  });

  const request: HeartbeatRequest = {
    type: 'file',
    entity: '/repo/src/index.ts',
    projectFolder: '/repo',
    category: 'coding',
  };

  tracker.track(request);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.timeout, WAKATIME_CLI_TIMEOUT_MS);
  assert.equal(calls[0].options.killSignal, 'SIGKILL');
  assert.ok(calls[0].args.includes('--sync-ai-disabled'));
});
