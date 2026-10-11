import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cognitionRoot, fail } from './cognition-contracts.mjs';

export function findCognitionPython() {
  if (process.env.DESKBOT_COGNITION_PYTHON) return process.env.DESKBOT_COGNITION_PYTHON;
  const bundled = process.env.USERPROFILE && join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe');
  if (bundled && existsSync(bundled)) return bundled;
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-c', 'import sys; assert sys.version_info >= (3, 11)'], { timeout: 3000, windowsHide: true });
    if (!probe.error && probe.status === 0) return candidate;
  }
  fail('python_unavailable', '需要 Python 3.11+；可用 DESKBOT_COGNITION_PYTHON 指定路径。');
}

export function createCognitionBridge({ python = findCognitionPython(), timeoutMs = 10000, workerFile = 'worker.py', maxFrames = 3, mode = 'mock' } = {}) {
  if (!['worker.py','life_worker.py'].includes(workerFile) || !['mock','real'].includes(mode)) fail('invalid_bridge_configuration');
  const children = new Set();
  function session(frame, modelRequest) {
    return new Promise((resolve, reject) => {
      // No inherited API keys, model configuration, DB path or network credentials.
      const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'LANG'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
      const child = spawn(python, ['-u', join(cognitionRoot, workerFile)], { env: { ...env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      children.add(child);
      let answer, error, frames = 0, stderr = '', settled = false;
      const timer = setTimeout(() => { error = Object.assign(new Error('Python session timed out'), { code: 'python_timeout' }); child.kill(); }, timeoutMs);
      const lines = createInterface({ input: child.stdout });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1200); });
      child.on('error', e => { error = Object.assign(e, { code: 'python_unavailable' }); });
      child.stdin.on('error', e => { error ??= e; });
      lines.on('line', async line => {
        try {
          if (++frames > maxFrames || line.length > 262144) fail('invalid_bridge_frame');
          const value = JSON.parse(line);
          if (value.type === 'model_request') {
            if (!modelRequest || value.mode !== mode || (workerFile === 'worker.py' && frames !== 1)) fail('invalid_model_request');
            const content = await modelRequest(value);
            if (!child.killed) child.stdin.write(JSON.stringify({ type: 'model_reply', mode, content }) + '\n');
          } else if (value.type === 'completed') answer = value.value;
          else if (value.type === 'error') fail('python_session_failed', value.error);
          else fail('invalid_bridge_frame');
        } catch (e) { error = e; child.kill(); }
      });
      child.on('close', code => {
        clearTimeout(timer); children.delete(child); lines.close();
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else if (code !== 0 || !answer) reject(Object.assign(new Error(`Python session failed (${code}): ${stderr}`), { code: 'python_session_failed' }));
        else resolve(answer);
      });
      child.stdin.write(JSON.stringify(frame) + '\n');
    });
  }
  return { session, close: () => { for (const child of children) child.kill(); }, status: () => ({ transport: 'stdio_ndjson', python, active_sessions: children.size }) };
}
