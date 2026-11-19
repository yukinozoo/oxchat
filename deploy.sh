#!/usr/bin/env bash
# OxChat 网页版一键部署：提交本地改动并推送到 GitHub，GitHub Actions 会自动构建并发布
# 用法：./deploy.sh <GitHub用户名> [仓库名，默认 oxchat]
set -euo pipefail

USER_NAME="${1:-}"
REPO="${2:-oxchat}"
if [ -z "$USER_NAME" ]; then
  echo "用法: ./deploy.sh <GitHub用户名> [仓库名，默认 oxchat]"
  exit 1
fi

cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git -c user.name="${GIT_USER_NAME:-OxChat}" -c user.email="${GIT_USER_EMAIL:-oxchat@local}" \
    commit -m "deploy: $(date '+%Y-%m-%d %H:%M:%S')"
else
  echo "没有需要提交的改动，直接推送"
fi

# 有 GITHUB_TOKEN 时用它做一次推送认证；推完立刻把 token 从 remote 里去掉
AUTH=""
if [ -n "${GITHUB_TOKEN:-}" ]; then
  AUTH="${GITHUB_TOKEN}@"
fi
git remote remove origin 2>/dev/null || true
git remote add origin "https://${AUTH}github.com/${USER_NAME}/${REPO}.git"
if ! git push -u origin main 2>&1 | sed "s/${GITHUB_TOKEN:-__none__}/***/g"; then
  git remote set-url origin "https://github.com/${USER_NAME}/${REPO}.git"
  echo "推送失败：检查 token 权限（需要 Contents: Read and write）" >&2
  exit 1
fi
git remote set-url origin "https://github.com/${USER_NAME}/${REPO}.git"

echo
echo "已推送。GitHub Actions 会自动构建并发布："
echo "  仓库: https://github.com/${USER_NAME}/${REPO}"
echo "  进度: https://github.com/${USER_NAME}/${REPO}/actions"
echo "  访问: https://${USER_NAME}.github.io/${REPO}/"
echo
echo "首次使用请先到 仓库 → Settings → Pages → Source 选择 GitHub Actions"
