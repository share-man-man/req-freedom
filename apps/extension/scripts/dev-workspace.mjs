import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'wxt';

/** 当前脚本所在目录。 */
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
/** 扩展项目根目录。 */
const extensionRoot = resolve(scriptDirectory, '..');
/** 仓库根目录。 */
const repositoryRoot = resolve(extensionRoot, '../..');
/** WXT 开发服务器。 */
const extensionServer = await createServer({ root: extensionRoot });

await extensionServer.start();

// 关键步骤：WXT 首次构建完成且浏览器打开后，最后启动 request-lab。
/** Request Lab 开发服务进程。 */
const labProcess = spawn(
  'mise',
  ['exec', '--', 'pnpm', '--filter', '@req-freedom/request-lab', 'dev'],
  {
    cwd: repositoryRoot,
    stdio: 'inherit',
  },
);
/** 是否已经开始关闭整套开发服务。 */
let shuttingDown = false;

/**
 * 关闭 Request Lab 与 WXT 开发服务器。
 * @param {NodeJS.Signals | undefined} signal 触发关闭的进程信号。
 * @returns {Promise<void>} 全部服务停止后完成。
 */
async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (labProcess.exitCode === null && labProcess.signalCode === null) {
    labProcess.kill(signal ?? 'SIGTERM');
  }
  await extensionServer.stop();
}

labProcess.once('error', (error) => {
  console.error('[req-freedom] Request Lab 启动失败：', error);
  process.exitCode = 1;
  void shutdown();
});

labProcess.once('exit', (code, signal) => {
  if (!shuttingDown && code !== 0) {
    console.error(`[req-freedom] Request Lab 异常退出（code=${String(code)}, signal=${String(signal)}）。`);
    process.exitCode = code ?? 1;
  }
  void shutdown();
});

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
