#!/usr/bin/env python3
"""用 GitHub API 推送本地 HEAD 提交：git push 走不通时的备用通道。

用法：GITHUB_TOKEN=ghp_xxx node 不适用——直接 python3 scripts/push-api.py [repo]

前提：远端 main 正好是本地 HEAD 的父提交（push 被网络卡住时通常成立）。
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
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:400]
        sys.exit(f"{method} {path} 失败: {error.code} {detail}")


def git(*args):
    return subprocess.check_output(["git", *args])


head = git("rev-parse", "HEAD").decode().strip()
parent = git("rev-parse", "HEAD^").decode().strip()
message = git("log", "-1", "--pretty=%B").decode().strip()

remote = call("GET", f"/git/ref/heads/{BRANCH}")["object"]["sha"]
if remote == head:
    sys.exit("远端已经是最新提交，无需推送")
if remote != parent:
    sys.exit(f"远端 main 是 {remote[:8]}，不是本地父提交 {parent[:8]}，先手动同步再试")

changes = [
    line.split("\t")
    for line in git("diff", "--name-status", "HEAD^", "HEAD").decode().splitlines()
    if line.strip()
]
print(f"提交 {head[:8]}，变更 {len(changes)} 个文件")

tree = []
for status, path in changes:
    if status.startswith("D"):
        tree.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
        continue
    content = git("show", f"HEAD:{path}")
    blob = call("POST", "/git/blobs", {
        "content": base64.b64encode(content).decode(),
        "encoding": "base64",
    })
    mode = "100755" if b"100755" in git("ls-tree", "HEAD", path) else "100644"
    tree.append({"path": path, "mode": mode, "type": "blob", "sha": blob["sha"]})
    print(f"  {status} {path}")

base_tree = call("GET", f"/git/commits/{remote}")["tree"]["sha"]
new_tree = call("POST", "/git/trees", {"base_tree": base_tree, "tree": tree})
commit = call("POST", "/git/commits", {"message": message, "tree": new_tree["sha"], "parents": [remote]})
call("PATCH", f"/git/refs/heads/{BRANCH}", {"sha": commit["sha"], "force": False})
print(f"已推送 {commit['sha'][:8]} 到 {repo}@{BRANCH}")
