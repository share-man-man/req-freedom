// 从矢量源 logo.svg 生成 Chrome 扩展所需的多尺寸位图图标。
// 单一真源：改图标只需编辑 assets/logo.svg，再跑 `pnpm --filter @req-freedom/extension icons`。
//
// WXT 约定式接入：public/icon/{size}.png 会被自动扫描并写入 manifest 的 icons 字段。
// 每个尺寸都用 Chrome 无头模式按目标像素「原生渲染」（而非缩放大图），16px 也保持清晰；
// 顺带在 assets/logo.png 落一份 128px 位图，供仓库预览与非构建引用。
//
// 依赖本机已安装 Chrome/Chromium（仅本地一次性动作，不进 CI）。

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 当前脚本所在目录（apps/extension/scripts） */
const scriptDir = dirname(fileURLToPath(import.meta.url));
/** 扩展包根目录（apps/extension） */
const extensionRoot = resolve(scriptDir, '..');

/** 矢量源：唯一真源，改图标只需替换此文件 */
const SOURCE_SVG = resolve(extensionRoot, 'assets/logo.svg');
/** WXT 约定的图标输出目录 */
const OUTPUT_DIR = resolve(extensionRoot, 'public/icon');
/** 仓库内的位图预览产物（128px） */
const PREVIEW_PNG = resolve(extensionRoot, 'assets/logo.png');
/** Chrome 扩展标准图标尺寸（工具栏 16/32、管理页 48、商店与安装 128） */
const ICON_SIZES = [16, 32, 48, 128];
/** 无头渲染用的浏览器候选路径（macOS） */
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

/**
 * 用无头浏览器把 SVG 按指定边长渲染为透明底 PNG。
 * @param {string} chrome 浏览器可执行文件路径
 * @param {string} svg SVG 源码文本
 * @param {number} size 目标边长（像素）
 * @param {string} output 输出 PNG 路径
 */
function renderIcon(chrome, svg, size, output) {
  // 内联 SVG 并用 CSS 强制缩放到目标尺寸；背景透明，页面无边距，保证像素对齐
  const html = `<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`;
  const htmlPath = join(tmpdir(), `reqfreedom-icon-${size}.html`);
  writeFileSync(htmlPath, html);
  execFileSync(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      '--hide-scrollbars',
      `--window-size=${size},${size}`,
      `--screenshot=${output}`,
      htmlPath,
    ],
    { stdio: 'ignore' },
  );
  rmSync(htmlPath, { force: true });
}

if (!existsSync(SOURCE_SVG)) {
  console.error(`找不到矢量源：${SOURCE_SVG}`);
  process.exit(1);
}

/** 首个存在的浏览器可执行文件；缺失则报错退出 */
const chrome = CHROME_CANDIDATES.find(existsSync);
if (!chrome) {
  console.error('未找到 Chrome/Chromium，无法渲染图标；请安装后重试。');
  process.exit(1);
}

const svg = readFileSync(SOURCE_SVG, 'utf8');
mkdirSync(OUTPUT_DIR, { recursive: true });
for (const size of ICON_SIZES) {
  renderIcon(chrome, svg, size, resolve(OUTPUT_DIR, `${size}.png`));
  console.log(`✔ icon/${size}.png`);
}
// 额外产出 128px 位图预览
renderIcon(chrome, svg, 128, PREVIEW_PNG);
console.log('✔ assets/logo.png');
console.log(`已从 ${SOURCE_SVG} 生成 ${ICON_SIZES.length} 个尺寸。`);
