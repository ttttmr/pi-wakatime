import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import path from 'node:path';
import { Dependencies } from './dependencies';
import {
  HeartbeatTracker,
  shouldTrackTool,
  estimateEditLineChanges,
} from './heartbeat';
import { logger, LogLevel } from './logger';
import { Options } from './options';
import type { ClaudeLikeHookEvent, HeartbeatRequest } from './types';
import { estimateWriteLineChanges, getPackageVersion } from './utils';
import { VERSION } from './version';

function buildPluginString(): string {
  const piVersion = getPackageVersion('@earendil-works/pi-coding-agent');
  const legacyPiVersion = piVersion === 'unknown' ? getPackageVersion('@mariozechner/pi-coding-agent') : piVersion;
  return `pi-coding-agent/${legacyPiVersion} pi-wakatime/${VERSION}`;
}


function buildSessionHeartbeat(
  ctx: ExtensionContext,
  sourceEvent: ClaudeLikeHookEvent,
): HeartbeatRequest {
  return {
    type: 'session',
    entity: path.join(ctx.cwd, '.pi-session'),
    projectFolder: ctx.cwd,
    category: 'coding',
    stateKey: ctx.sessionManager.getSessionId(),
    sourceEvent,
  };
}

function buildFileHeartbeat(
  toolName: string,
  input: Record<string, unknown>,
  ctx: { cwd: string },
): HeartbeatRequest | undefined {
  const rawPath = typeof input.path === 'string' ? input.path : undefined;
  if (!rawPath) return undefined;

  const entity = path.resolve(ctx.cwd, rawPath);

  if (toolName === 'read') {
    return {
      type: 'file',
      entity,
      projectFolder: ctx.cwd,
      category: 'coding',
      sourceEvent: 'PostToolUse',
    };
  }

  if (toolName === 'write') {
    return {
      type: 'file',
      entity,
      projectFolder: ctx.cwd,
      category: 'coding',
      isWrite: true,
      lineChanges: estimateWriteLineChanges(typeof input.content === 'string' ? input.content : ''),
      sourceEvent: 'PostToolUse',
    };
  }

  if (toolName === 'edit') {
    const edits = Array.isArray(input.edits)
      ? input.edits.filter((edit): edit is { oldText?: string; newText?: string } => typeof edit === 'object' && edit !== null)
      : [];

    return {
      type: 'file',
      entity,
      projectFolder: ctx.cwd,
      category: 'coding',
      isWrite: true,
      lineChanges: estimateEditLineChanges(edits),
      sourceEvent: 'PostToolUse',
    };
  }

  return undefined;
}

export default function (pi: ExtensionAPI) {
  const options = new Options();
  logger.setLevel(options.getSetting('settings', 'debug') === 'true' ? LogLevel.DEBUG : LogLevel.INFO);

  const dependencies = new Dependencies(options, logger);
  const tracker = new HeartbeatTracker({
    dependencies,
    plugin: buildPluginString(),
  });

  const initPromise = tracker.init().catch((error) => {
    logger.errorException(error);
    throw error;
  });

  const ensureInitialized = async (): Promise<boolean> => {
    try {
      await initPromise;
      return true;
    } catch {
      return false;
    }
  };

  const trackSessionEvent = async (
    hookEvent: ClaudeLikeHookEvent,
    ctx: ExtensionContext,
  ) => {
    if (!(await ensureInitialized())) return;
    tracker.track(buildSessionHeartbeat(ctx, hookEvent));
  };

  pi.on('turn_start', async (_event, ctx) => {
    await trackSessionEvent('UserPromptSubmit', ctx);
  });

  pi.on('tool_call', async (_event, ctx) => {
    await trackSessionEvent('PreToolUse', ctx);
  });

  pi.on('tool_result', async (event, ctx) => {
    if (!(await ensureInitialized())) return;

    tracker.track(buildSessionHeartbeat(ctx, 'PostToolUse'));

    if (event.isError || !shouldTrackTool(event.toolName)) {
      return;
    }

    const request = buildFileHeartbeat(event.toolName, event.input as Record<string, unknown>, ctx);
    if (request) {
      tracker.track(request);
    }
  });

  pi.on('session_before_compact', async (_event, ctx) => {
    await trackSessionEvent('PreCompact', ctx);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    await trackSessionEvent('SessionEnd', ctx);
  });

  logger.debug(`Loaded pi-wakatime/${VERSION} with plugin ${buildPluginString()}`);
}
