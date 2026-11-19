#!/usr/bin/env python3
"""用 GitHub API 推送本地 HEAD：git push 走不通时（国内常见）的备用通道。

与远端做全量树对比，只上传有差异的文件；远端历史被 API 重写过也能正确续上。

用法：GITHUB_TOKEN=ghp_xxx python3 scripts/push-api.py [owner/repo]
"""
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

TOKEN = os.environ.get("GITHUB_TOKEN", "")
if not TOKEN:
    sys.exit("需要 GITHUB_TOKEN 环境变量")

repo = sys.argv[1] if len(sys.argv) > 1 else None
if not repo:
    url = subprocess.check_output(["git", "config", "--get", "remote.origin.url"], text=True).strip()
    repo = url.split("github.com")[-1].lstrip(":/").removesuffix(".git")

API = f"https://api.github.com/repos/{repo}"
BRANCH = "main"


def call(method, path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(
        API + path, data=data, method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "oxchat-release",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:400]
        sys.exit(f"{method} {path} 失败: {error.code} {detail}")


def git(*args, binary=False):
    return subprocess.check_output(["git", *args], text=not binary)


head = git("rev-parse", "HEAD").strip()
message = git("log", "-1", "--pretty=%B").strip() or "deploy"

remote_sha = call("GET", f"/git/ref/heads/{BRANCH}")["object"]["sha"]
if remote_sha == head:
    sys.exit("远端已经是最新提交，无需推送")

remote_tree = call("GET", f"/git/trees/{remote_sha}?recursive=1")
remote_files = {
    item["path"]: item["sha"]
    for item in remote_tree.get("tree", [])
    if item["type"] == "blob"
}

# 本地 HEAD 的完整文件清单：blob sha 由内容决定，可以直接与远端比对
local_files = {}
for line in git("ls-tree", "-r", "HEAD").splitlines():
    meta, path = line.split("\t", 1)
    mode, kind, sha = meta.split()
    if kind == "blob":
        local_files[path] = (mode, sha)

changed = [path for path, (_, sha) in local_files.items() if remote_files.get(path) != sha]
removed = [path for path in remote_files if path not in local_files]
if not changed and not removed:
    sys.exit("内容与远端一致，无需推送")

print(f"本地 {head[:8]}，远端 {remote_sha[:8]}：新增/修改 {len(changed)} 个，删除 {len(removed)} 个")

tree = []
for path in removed:
    tree.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
for path in changed:
    mode, _ = local_files[path]
    content = git("show", f"HEAD:{path}", binary=True)
    blob = call("POST", "/git/blobs", {
        "content": base64.b64encode(content).decode(),
        "encoding": "base64",
    })
    tree.append({
        "path": path,
        "mode": "100755" if mode == "100755" else "100644",
        "type": "blob",
        "sha": blob["sha"],
    })
    print(f"  {path}")

remote_base_tree = call("GET", f"/git/commits/{remote_sha}")["tree"]["sha"]
new_tree = call("POST", "/git/trees", {"base_tree": remote_base_tree, "tree": tree})
commit = call("POST", "/git/commits", {
    "message": message,
    "tree": new_tree["sha"],
    "parents": [remote_sha],
})
call("PATCH", f"/git/refs/heads/{BRANCH}", {"sha": commit["sha"], "force": False})
print(f"已推送 {commit['sha'][:8]} 到 {repo}@{BRANCH}")
