import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportCanonicalReplayCapture, replayCanonicalCapture } from '../apps/deskbot-service/src/replay-capture.mjs';

export function parseReplayCaptureArgs(args) {
  const [command, ...rest] = args, options = {};
  if (!['export', 'replay'].includes(command)) throw Error('choose_export_or_replay');
  for (let index = 0; index < rest.length; index += 2) {
    if (!['--archive', '--database', '--target', '--restart-at'].includes(rest[index]) || !rest[index + 1] || rest[index + 1].startsWith('--')) throw Error('invalid_replay_capture_option');
    if (Object.hasOwn(options, rest[index])) throw Error('duplicate_replay_capture_option');
    options[rest[index]] = rest[index + 1];
  }
  if (!options['--archive']) throw Error('archive_required');
  if (command === 'export' && (!options['--database'] || options['--target'] || options['--restart-at'])) throw Error('export_requires_database_only');
  if (command === 'replay' && (!options['--target'] || options['--database'])) throw Error('replay_requires_new_target_only');
  const restartAt = options['--restart-at'] === undefined ? null : Number(options['--restart-at']);
  if (restartAt !== null && (!Number.isSafeInteger(restartAt) || restartAt < 0)) throw Error('invalid_restart_at');
  return { command, directory: resolve(options['--archive']), databasePath: options['--database'], targetDatabase: options['--target'], restartAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseReplayCaptureArgs(process.argv.slice(2));
    const result = options.command === 'export' ? exportCanonicalReplayCapture(options) : replayCanonicalCapture(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Operational classification only: no captured conversation/provider prose.
    console.error(error.code ?? error.message); process.exitCode = 1;
  }
}
