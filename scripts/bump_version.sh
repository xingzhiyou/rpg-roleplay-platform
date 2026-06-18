#!/usr/bin/env bash
# bump_version.sh <new-version>  — 版本号单一真源维护脚本(SemVer)。
#
# 把根 VERSION 设为 <new-version>,并同步派生位:frontend/package.json、rpg/pyproject.toml,
# 再把 CHANGELOG 的 [Unreleased] 收口为 [<new-version>] - <today> 并新建空 [Unreleased]。
# 不自动 commit / tag —— 末尾打印建议命令,由发版者确认后执行(tag 只打在 OSS origin)。
#
# 版本规则:MAJOR.MINOR.PATCH[-channel.N];新增 DB migration 至少 bump MINOR。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEW="${1:-}"

if [[ -z "$NEW" ]]; then echo "用法: $0 <new-version>  例如 0.6.0 / 0.6.0-beta.1" >&2; exit 1; fi
# 宽松 SemVer 校验(MAJOR.MINOR.PATCH 可带 -prerelease)
if ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "✗ 非法 SemVer: $NEW (期望 X.Y.Z 或 X.Y.Z-channel.N)" >&2; exit 1
fi

OLD="$(cat "$ROOT/VERSION" 2>/dev/null || echo none)"
TODAY="$(date +%F)"
SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"

echo "$NEW" > "$ROOT/VERSION"
# package.json: 仅改顶层 "version"(第一处)
sed -i.bak "0,/\"version\": *\"[^\"]*\"/s//\"version\": \"$NEW\"/" "$ROOT/frontend/package.json" && rm -f "$ROOT/frontend/package.json.bak"
# pyproject.toml: 顶层 version
sed -i.bak "s/^version = \"[^\"]*\"/version = \"$NEW\"/" "$ROOT/rpg/pyproject.toml" && rm -f "$ROOT/rpg/pyproject.toml.bak"
# CHANGELOG: [Unreleased] → [NEW] - today (@ sha) + 新空 [Unreleased]
if grep -q '^## \[Unreleased\]' "$ROOT/CHANGELOG.md"; then
  perl -0pi -e "s/## \\[Unreleased\\]/## [Unreleased]\n\n## [$NEW] - $TODAY (\@ $SHA)/" "$ROOT/CHANGELOG.md"
fi

echo "✓ VERSION $OLD → $NEW;已同步 package.json / pyproject.toml / CHANGELOG"
echo ""
echo "下一步(确认后手动执行):"
echo "  git add VERSION frontend/package.json rpg/pyproject.toml CHANGELOG.md"
echo "  git commit -m \"chore(release): v$NEW\""
echo "  # 仅在 OSS origin 打 tag(打包/发版触发):"
echo "  git tag -a v$NEW -m \"v$NEW\"   &&   git push origin v$NEW"
