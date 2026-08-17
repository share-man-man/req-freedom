#!/usr/bin/env bash
#
# 构建扩展并组装成一个可用普通浏览器打开的演示站点。
#
# 只做「构建 + 组装」，不启动任何常驻进程——服务器和浏览器由 capture.mjs
# 自己拉起并在结束时收掉，免得残留进程占端口、跨会话互相干扰。
#
# 配置读自仓库根的 .store-assets/config.json（没有就先跑 scripts/init.sh）。
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"
CONFIG="$REPO_ROOT/.store-assets/config.json"

[ -f "$CONFIG" ] || { echo "缺少 $CONFIG，先执行 $SKILL_DIR/scripts/init.sh" >&2; exit 1; }

# 用 python 读 JSON，避免依赖 jq
read_config() {
  python3 -c "import json; print(json.load(open('$CONFIG')).get('$1',''))"
}

BUILD_COMMAND="$(read_config buildCommand)"
BUILD_DIR="$REPO_ROOT/$(read_config buildDir)"
WORK_DIR="$REPO_ROOT/$(read_config workDir)"
SITE_DIR="$WORK_DIR/site"

if [ -n "${STORE_ASSETS_SKIP_BUILD:-}" ]; then
  echo "==> 跳过构建（STORE_ASSETS_SKIP_BUILD）"
else
  echo "==> 构建扩展：$BUILD_COMMAND"
  (cd "$REPO_ROOT" && eval "$BUILD_COMMAND")
fi

[ -f "$BUILD_DIR/manifest.json" ] || {
  echo "构建产物不像扩展：$BUILD_DIR 下没有 manifest.json（检查 config.json 的 buildDir）" >&2
  exit 1
}

echo "==> 组装演示站点 $SITE_DIR"
rm -rf "$SITE_DIR"
mkdir -p "$SITE_DIR"
cp -R "$BUILD_DIR/" "$SITE_DIR/"
cp "$SKILL_DIR/assets/chrome-shim.js" "$SKILL_DIR/assets/autoview.js" "$SITE_DIR/"
cp "$REPO_ROOT/.store-assets/seed.js" "$SITE_DIR/"
if [ -d "$REPO_ROOT/.store-assets/pages" ]; then
  mkdir -p "$SITE_DIR/pages"
  cp -R "$REPO_ROOT/.store-assets/pages/." "$SITE_DIR/pages/"
fi

# 构建产出的 HTML 里没有垫片，必须在入口脚本之前插进去
python3 - "$SITE_DIR" "$CONFIG" <<'PY'
import json, pathlib, re, sys

site = pathlib.Path(sys.argv[1])
config = json.load(open(sys.argv[2]))

# 顺序有意义：seed 先挂数据，chrome-shim 才读得到；两者都要早于页面入口模块
HEAD = (
    '<script src="/seed.js"></script>\n'
    '    <script src="/chrome-shim.js"></script>\n    '
)
TAIL = '    <script src="/autoview.js"></script>\n  </body>'

for name in config.get("pages", []):
    path = site / name
    if not path.exists():
        raise SystemExit(f"config.json 的 pages 里写了 {name}，但构建产物中不存在")
    html = path.read_text(encoding="utf-8")
    if "chrome-shim.js" not in html:
        # 插到第一个脚本标签之前；没有脚本标签的页面退回 </head>
        if re.search(r"<script", html):
            html = re.sub(r"<script", HEAD + "<script", html, count=1)
        else:
            html = html.replace("</head>", HEAD + "</head>", 1)
    if "autoview.js" not in html:
        html = html.replace("</body>", TAIL, 1)
    path.write_text(html, encoding="utf-8")
    print(f"    注入 {name}")
PY

echo
echo "站点就绪：$SITE_DIR"
echo "接着执行：node $SKILL_DIR/scripts/capture.mjs"
