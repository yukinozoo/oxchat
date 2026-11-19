#!/usr/bin/env bash
# OxChat 一键发布：打包 APK → 生成 update.json → 传 GitHub Release → 部署网页
#
# 用法：
#   ./release.sh "更新说明"            # 完整流程
#   ./release.sh "更新说明" --dry-run   # 只打印将执行的步骤
#   ./release.sh --skip-apk            # 复用最近一次构建的 APK（不重新打包）
#   ./release.sh --no-deploy           # 只发 Release，不推网页
#
# 凭据：优先用已登录的 gh；没有 gh 时读 GITHUB_TOKEN 直接调 API。
set -euo pipefail

cd "$(dirname "$0")"

APP_DIR="/root/workspace/oxchat-app"
ANDROID_DIR="$APP_DIR/android"
APK_OUT="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
DIST_DIR="/sdcard/Download/DSH-Go"
REPO="${OXCHAT_REPO:-$(git config --get remote.origin.url | sed -E 's#.*github\.com[:/]([^/]+/[^/.]+)(\.git)?$#\1#')}"
REPO="${REPO:-yukinozoo/oxchat}"

NOTES=""
DRY_RUN=0
SKIP_APK=0
DEPLOY=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-apk) SKIP_APK=1 ;;
    --no-deploy) DEPLOY=0 ;;
    --*) echo "未知参数: $arg" >&2; exit 1 ;;
    *) NOTES="$arg" ;;
  esac
done

run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "  \$ $*"
  else
    "$@"
  fi
}

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

version_code=$(grep -oE 'versionCode[[:space:]]+[0-9]+' "$ANDROID_DIR/app/build.gradle" | head -1 | grep -oE '[0-9]+')
version_name=$(grep -oE 'versionName[[:space:]]+"[^"]+"' "$ANDROID_DIR/app/build.gradle" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
if [ -z "$version_code" ] || [ -z "$version_name" ]; then
  echo "没在 build.gradle 里读到 versionCode / versionName" >&2
  exit 1
fi
tag="v$version_name"
notes=${NOTES:-"OxChat $version_name"}

echo "版本: $version_name ($version_code)  仓库: $REPO  标签: $tag"

if [ "$SKIP_APK" = "0" ]; then
  step "1/5 构建网页"
  run bash -c "cd /root/workspace/oxchat-build && pnpm type && pnpm lint && pnpm build"

  step "2/5 生成 www 并打包 APK"
  run python3 "$APP_DIR/prepare-www.py"
  run bash -c "cd $APP_DIR && npx cap sync android"
  run bash -c "cd $ANDROID_DIR && JAVA_HOME=/usr/lib/jvm/java-21-openjdk-arm64 ANDROID_HOME=/root/android-sdk ANDROID_SDK_ROOT=/root/android-sdk /opt/gradle-8.13/bin/gradle assembleRelease --no-daemon --console=plain"

  if [ "$DRY_RUN" = "0" ]; then
    cp -f "$APK_OUT" "$DIST_DIR/OxChat-$version_name-release.apk"
    sync
    echo "  已复制到 $DIST_DIR/OxChat-$version_name-release.apk"
  fi
else
  step "1-2/5 跳过打包，复用 $APK_OUT"
  [ -f "$APK_OUT" ] || { echo "找不到 $APK_OUT" >&2; exit 1; }
fi

apk="$DIST_DIR/OxChat-$version_name-release.apk"
[ -f "$apk" ] || apk="$APK_OUT"

step "3/5 生成更新清单 src/update.json"
run node scripts/make-update.mjs "$apk" "$notes"

# 清单变了要重新构建，Pages 用的是构建产物里的 update.json
if [ "$SKIP_APK" = "0" ] && [ "$DRY_RUN" = "0" ]; then
  echo "  重新构建站点产物（带上新的 update.json）"
  (cd /root/workspace/oxchat-build && pnpm build >/dev/null)
fi

step "4/5 上传 APK 到 GitHub Release $tag"

# 需要 gh 或 GITHUB_TOKEN：两者都没有时只给出手动命令
publish_with_gh() {
  if gh release view "$tag" --repo "$REPO" >/dev/null 2>&1; then
    gh release upload "$tag" "$apk#OxChat-latest.apk" "$apk#OxChat-$version_name.apk" --clobber --repo "$REPO"
  else
    gh release create "$tag" "$apk#OxChat-latest.apk" "$apk#OxChat-$version_name.apk" \
      --repo "$REPO" --title "OxChat $version_name" --notes "$notes"
  fi
}

# 没有 gh 时用 API：建/找发布，删掉同名旧资产再上传，保证可重复执行
publish_with_api() {
  local api="https://api.github.com/repos/$REPO"
  local auth=(-H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json")
  local body
  body=$(printf '{"tag_name":"%s","name":"OxChat %s","body":"%s","draft":false,"prerelease":false}' \
    "$tag" "$version_name" "${notes//\"/\\\"}")

  local release_json
  release_json=$(curl -sS "${auth[@]}" "$api/releases/tags/$tag" || true)
  if ! printf '%s' "$release_json" | grep -q '"upload_url"'; then
    release_json=$(curl -sS -X POST "${auth[@]}" -d "$body" "$api/releases")
  fi
  local upload_url
  upload_url=$(printf '%s' "$release_json" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    print("")
else:
    print(str(data.get("upload_url", "")).split("{")[0])
')
  if [ -z "$upload_url" ]; then
    echo "创建 Release 失败：$release_json" >&2
    return 1
  fi
  # 清掉同名旧资产，避免重复上传报错
  for name in "OxChat-latest.apk" "OxChat-$version_name.apk"; do
    local asset_id
    asset_id=$(printf '%s' "$release_json" | ASSET="$name" python3 -c '
import json, os, sys
data = json.load(sys.stdin)
for asset in data.get("assets", []):
    if asset.get("name") == os.environ["ASSET"]:
        print(asset["id"])
        break
')
    if [ -n "$asset_id" ]; then
      curl -sS -X DELETE "${auth[@]}" "$api/releases/assets/$asset_id" >/dev/null
    fi
  done
  for name in "OxChat-latest.apk" "OxChat-$version_name.apk"; do
    curl -sS -X POST "${auth[@]}" \
      -H "Content-Type: application/vnd.android.package-archive" \
      --data-binary "@$apk" "$upload_url?name=$name" >/dev/null
    echo "  已上传 $name"
  done
}

if [ "$DRY_RUN" = "1" ]; then
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    echo "  \$ gh release create $tag \"$apk#OxChat-latest.apk\" \"$apk#OxChat-$version_name.apk\" --title ... --notes ..."
  elif [ -n "${GITHUB_TOKEN:-}" ]; then
    echo "  \$ curl -X POST https://api.github.com/repos/$REPO/releases  (GITHUB_TOKEN)"
    echo "  \$ curl -X POST $REPO upload_url?name=OxChat-latest.apk"
  else
    echo "  （本机没有 gh / GITHUB_TOKEN：真跑时会停在这一步并给出手动上传命令）"
  fi
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  publish_with_gh
elif [ -n "${GITHUB_TOKEN:-}" ]; then
  publish_with_api
else
  echo "没有可用的发布凭据。任选其一：" >&2
  echo "  1) 安装并登录 gh：pkg install gh -> gh auth login" >&2
  echo "  2) 提供 token：GITHUB_TOKEN=ghp_xxx ./release.sh \"$notes\"" >&2
  echo "手动上传：把 $apk 传到 $REPO 的 Release $tag，资产名用 OxChat-latest.apk 与 OxChat-$version_name.apk" >&2
  exit 3
fi

if [ "$DEPLOY" = "1" ]; then
  step "5/5 发布网页（update.json 生效）"
  run ./deploy.sh "${REPO%%/*}" "${REPO##*/}"
else
  step "5/5 已按要求跳过网页部署"
fi

cat <<EOF

完成：$version_name ($version_code)
  更新清单地址: https://${REPO%%/*}.github.io/${REPO##*/}/update.json
  APK 直链:     https://github.com/$REPO/releases/latest/download/OxChat-latest.apk
  代理直链:     https://gh-proxy.com/https://github.com/$REPO/releases/latest/download/OxChat-latest.apk
EOF
