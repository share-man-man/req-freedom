#!/usr/bin/env bash

# 由 release-extension 项目 skill 调用，统一执行扩展发布的确定性步骤。

set -euo pipefail

# Chrome 扩展发布只允许从最新且干净的 main 执行，避免把未提交改动混入版本提交。
readonly SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 脚本位于 .agents/skills/release-extension/scripts，向上四级回到仓库根目录。
readonly REPOSITORY_ROOT="$(cd "${SCRIPT_DIRECTORY}/../../../.." && pwd)"
readonly EXTENSION_PACKAGE="apps/extension/package.json"
readonly PUBLISH_WORKFLOW="publish-chrome.yml"
readonly WORKFLOW_DISCOVERY_ATTEMPTS=30
readonly WORKFLOW_DISCOVERY_INTERVAL_SECONDS=5

cd "${REPOSITORY_ROOT}"

if [[ $# -ne 1 || ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
  echo "用法：mise exec -- pnpm release:extension <version>" >&2
  echo "版本应根据本次功能、兼容性与改动规模按 SemVer 判断；示例：mise exec -- pnpm release:extension 0.6.0" >&2
  exit 1
fi

# 当前扩展版本用于展示版本变化及判断同版本续跑。
readonly CURRENT_VERSION="$(mise exec -- node -p "require('./${EXTENSION_PACKAGE}').version")"
readonly RELEASE_VERSION="$1"
readonly RELEASE_TAG="v${RELEASE_VERSION}"
readonly RELEASE_COMMIT_MESSAGE="chore(release): prepare extension ${RELEASE_TAG}"

echo "准备发布 Chrome 扩展：${CURRENT_VERSION} -> ${RELEASE_VERSION}"

# 发布前先拒绝错误分支和无关改动；仅允许续跑上次校验中断后留下的同版本变更。
readonly CURRENT_BRANCH="$(mise exec -- git branch --show-current)"
if [[ "${CURRENT_BRANCH}" != "main" ]]; then
  echo "只能从 main 发布，当前分支为 ${CURRENT_BRANCH:-<detached HEAD>}。" >&2
  exit 1
fi

# 当前工作区状态用于区分全新发布和同版本续跑。
readonly INITIAL_CHANGES="$(mise exec -- git status --porcelain --untracked-files=all)"
if [[ -n "${INITIAL_CHANGES}" && ( "${INITIAL_CHANGES}" != " M ${EXTENSION_PACKAGE}" || "${CURRENT_VERSION}" != "${RELEASE_VERSION}" ) ]]; then
  echo "工作区包含本次发布以外的改动，请先提交或处理后再发布。" >&2
  mise exec -- git status --short
  exit 1
fi

# 发布完成后必须读取并等待 GitHub Actions，在修改版本前检查 CLI 和认证状态。
if ! command -v gh >/dev/null 2>&1; then
  echo "未找到 GitHub CLI（gh），无法执行完整发布流程。" >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI 认证不可用，请检查 gh auth status 与网络连接。" >&2
  exit 1
fi

if [[ -z "${INITIAL_CHANGES}" ]]; then
  echo "==> 同步最新 main"
  mise exec -- git pull --ff-only origin main
else
  echo "==> 续跑扩展 ${RELEASE_VERSION} 的发布检查"
  mise exec -- git fetch origin main
  # 有版本改动时不能直接 pull；改为确认当前提交仍与远端 main 一致。
  readonly LOCAL_HEAD="$(mise exec -- git rev-parse HEAD)"
  readonly REMOTE_MAIN_HEAD="$(mise exec -- git rev-parse origin/main)"
  if [[ "${LOCAL_HEAD}" != "${REMOTE_MAIN_HEAD}" ]]; then
    echo "远端 main 已变化，请先处理 ${EXTENSION_PACKAGE} 的版本改动并同步分支。" >&2
    exit 1
  fi
fi

# 已存在的本地或远端标签都不可覆盖，发布失败时应使用新版本重试。
if mise exec -- git rev-parse --quiet --verify "refs/tags/${RELEASE_TAG}" >/dev/null; then
  echo "本地标签 ${RELEASE_TAG} 已存在，请使用新版本号。" >&2
  exit 1
fi
if mise exec -- git ls-remote --exit-code --tags origin "refs/tags/${RELEASE_TAG}" >/dev/null 2>&1; then
  echo "远端标签 ${RELEASE_TAG} 已存在，请使用新版本号。" >&2
  exit 1
fi

if [[ -z "${INITIAL_CHANGES}" ]]; then
  echo "==> 更新扩展版本为 ${RELEASE_VERSION}"
  mise exec -- pnpm version:extension "${RELEASE_VERSION}"
fi

echo "==> 执行类型检查"
mise exec -- pnpm typecheck

echo "==> 执行测试"
mise exec -- pnpm test

echo "==> 执行构建"
mise exec -- pnpm build

echo "==> 检查未使用依赖与导出"
mise exec -- pnpm knip

# 完整检查不应产生额外的已跟踪或未跟踪文件，否则版本提交范围不再可控。
readonly RELEASE_CHANGES="$(mise exec -- git status --porcelain --untracked-files=all)"
if [[ "${RELEASE_CHANGES}" != " M ${EXTENSION_PACKAGE}" ]]; then
  echo "发布检查后存在预期外改动，已停止发布：" >&2
  mise exec -- git status --short
  exit 1
fi

# 标签推送会触发 publish-chrome.yml，自动上传并提交 Chrome Web Store 审核。
echo "==> 创建版本提交与发布标签"
mise exec -- git add "${EXTENSION_PACKAGE}"
mise exec -- git commit -m "${RELEASE_COMMIT_MESSAGE}"
mise exec -- git tag "${RELEASE_TAG}"
# 发布提交 SHA 用于精确定位标签触发的工作流，避免误等其他人的发布任务。
readonly RELEASE_COMMIT_SHA="$(mise exec -- git rev-parse HEAD)"

# 原子推送避免只推送了版本提交或只推送了标签，导致远端进入半发布状态。
echo "==> 原子推送 main 与 ${RELEASE_TAG}"
mise exec -- git push --atomic origin main "${RELEASE_TAG}"

echo "==> 等待 GitHub 创建发布工作流"
# 工作流记录在标签推送后可能延迟数秒出现，限定提交 SHA 轮询以获得准确的 run ID 与页面地址。
WORKFLOW_RUN=""
for (( ATTEMPT = 1; ATTEMPT <= WORKFLOW_DISCOVERY_ATTEMPTS; ATTEMPT += 1 )); do
  WORKFLOW_RUN="$(gh run list \
    --workflow "${PUBLISH_WORKFLOW}" \
    --commit "${RELEASE_COMMIT_SHA}" \
    --event push \
    --limit 1 \
    --json databaseId,url \
    --jq '(.[0] // empty) | [.databaseId, .url] | @tsv')"
  if [[ -n "${WORKFLOW_RUN}" ]]; then
    break
  fi
  sleep "${WORKFLOW_DISCOVERY_INTERVAL_SECONDS}"
done

if [[ -z "${WORKFLOW_RUN}" ]]; then
  echo "未能找到 ${RELEASE_TAG} 对应的发布工作流，请到 GitHub Actions 检查。" >&2
  exit 1
fi

# gh 返回以制表符分隔的 run ID 与 URL。
readonly WORKFLOW_RUN_ID="${WORKFLOW_RUN%%$'\t'*}"
readonly WORKFLOW_RUN_URL="${WORKFLOW_RUN#*$'\t'}"
echo "发布工作流：${WORKFLOW_RUN_URL}"

if ! gh run watch "${WORKFLOW_RUN_ID}" --compact --exit-status; then
  echo "发布工作流失败。修复问题后请使用新版本重新发布，不要移动或复用 ${RELEASE_TAG}。" >&2
  exit 1
fi

echo "发布工作流已成功，扩展已提交 Chrome Web Store 审核；审核通过后将自动上线。"
