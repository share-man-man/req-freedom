#!/usr/bin/env bash
#
# 在当前仓库生成 .store-assets/ 骨架，供 store-assets skill 使用。
# 已存在的文件不会被覆盖，可反复执行。
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="${1:-$(git rev-parse --show-toplevel)}"
TARGET="$REPO_ROOT/.store-assets"

mkdir -p "$TARGET/pages"

# 单个模板文件的落地：已存在则跳过，避免覆盖项目已经调好的内容
copy_template() {
  local src="$1" dest="$2"
  if [ -e "$dest" ]; then
    echo "  跳过（已存在） ${dest#"$REPO_ROOT"/}"
  else
    cp "$src" "$dest"
    echo "  生成 ${dest#"$REPO_ROOT"/}"
  fi
}

copy_template "$SKILL_DIR/assets/templates/config.json" "$TARGET/config.json"
copy_template "$SKILL_DIR/assets/templates/seed.js" "$TARGET/seed.js"
copy_template "$SKILL_DIR/assets/templates/popup-frame.html" "$TARGET/pages/popup-frame.html"

cat <<EOF

已生成 ${TARGET#"$REPO_ROOT"/}/，接下来：

  1. 改 config.json：buildCommand / buildDir / workDir / pages 要对上本项目
     （workDir 必须落在 .gitignore 忽略的路径下）
  2. 改 seed.js：按扩展真实的 storage 键名和数据结构造演示数据
  3. 改 pages/ 下的合成页与宣传图设计稿
  4. 跑 scripts/prepare.sh，再跑 scripts/capture.mjs
EOF
