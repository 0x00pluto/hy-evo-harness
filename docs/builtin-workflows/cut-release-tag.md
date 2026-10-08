# 打发版 tag（upgrades 说明 + tag，Release 由 Actions 创建）

**日常发版唯一入口**：每次升版只雇本篇。

可复跑：从上一 Git tag 到当前 HEAD 汇总变更 → 写 `upgrades/` 发版记录 → 对齐 `package.json` 的 `version` → 本地提交并打 tag → 推送 tag。

推送 `v*` tag 后，GitHub Actions 打包 macOS / Windows / Linux，并创建 GitHub Release 页（说明按提交自动生成，安装包由 CI 上传）。细节见 [build-and-release.md](../build-and-release.md)。

**禁止**无 `upgrades/` 页直接打 tag。

**禁止**在本地或网页执行 `gh release create` / Publish release。Release 已存在时 CI 的上传会和它抢同一个 tag。`upgrades/$TAG.md` 是仓内记录，不是 GitHub Release 正文。

## 入口

```text
1. 打开当前工作区（一次只雇本仓）
2. 阅读本篇全文
3. 按「日常步骤」执行；缺信息或需升 major → 停，按失败排查问询
4. 验收：远程有 tag；package.json 的 version 与 tag 一致；Actions 正在或已经创建 Release
```

本工作流由 Agent 对话驱动。不提供 Python CLI。

## 参数

| 输入 | 说明 |
|---|---|
| 当前仓路径 | 默认即打开的工作区根目录 |
| `$TAG` | `vX.Y.Z`；可由 SemVer 规则算出，或人显式覆盖 |
| 是否代推 | 默认**只输出**推送命令；**仅当用户本轮明确要求代推**时 Agent 才执行 `git push`。不要代建 Release |

## 分工

| 角色 | 职责 |
|---|---|
| Agent | 查上一 tag..HEAD；按 SemVer 定版号（major 除外）；写 `upgrades/$TAG.md`；更新 `upgrades/README.md`；对齐 `package.json` 的 `version`；本地 `git commit` + `git tag`；默认只给出推送命令 |
| 人 | major（及跳号 / 覆盖版号）时**显式指定**；自行推送，或本轮明确授权 Agent 代推 |
| Actions | 三端打包，创建 GitHub Release，上传安装包与 `latest*.yml` |

## 版号规则（SemVer · 铁律）

相对上一 tag `vMAJOR.MINOR.PATCH`：

| 变更类型 | 怎么升 | 谁决定 |
|---|---|---|
| 小补丁 / 修复 / 与发版无关的小改 | `PATCH +1` | Agent 按 SemVer 自动取下一号 |
| 功能变更 / 向后兼容的新能力 | `MINOR +1`，`PATCH` 归零 | Agent 按 SemVer 自动取下一号 |
| 不兼容 / 重大跃迁 | `MAJOR +1`，`MINOR` / `PATCH` 归零 | **必须人显式指定**；Agent **禁止**自行升 major |

细则：

- 尚无任何 `v*` tag（首发）→ 默认 `$TAG=v0.1.0`（或人指定）；发版页写「首发：本仓首个发版」而非「相对上一 tag」。
- Agent 根据「上一 tag..HEAD」判定 patch 或 minor，直接采用算出的 `$TAG`。
- 若可能涉及 **breaking / major**：Agent **停住**，说明理由并请人给出目标 major；未确认前不得打 major tag。
- 人可随时覆盖：显式说出目标 tag 时，以指定为准。
- 跳号须人显式指定；默认不跳号。
- `$TAG` 去掉 `v` 后必须等于 `package.json` 的 `version`。

## 日常步骤

```text
查上一 tag 与 PREV..HEAD 变更
→ 定版号 $TAG（major/跳号 → 等人口头确认）
→ 写 upgrades/$TAG.md + 更新 upgrades/README.md 索引
→ 对齐 package.json 的 version（= $TAG 去 v）
→ 本地 commit + git tag $TAG
→ 输出（或经授权执行）git push 分支与 tag
→ 停。不要创建 GitHub Release
→ 验收：远程 tag；Actions 创建的 Release 含安装包
```

展开：

### 0. 前置

- 功能改动已提交到默认分支（或即将随本流程一并提交的仅限 upgrades / 版本号相关文件）。
- 工作区干净，或仅剩即将写入的 `upgrades/` 与 `package.json`。

### 1. 查上一 tag 与变更

```bash
PREV=$(git tag -l 'v*' --sort=-v:refname | head -1)
echo "prev=$PREV"
# 无 PREV 时跳过 log/diff，按首发处理
git log "${PREV}..HEAD" --oneline
git diff "${PREV}..HEAD" --stat
```

把用户可见变更整理成「相对 `$PREV`」的要点（供仓内发版记录；GitHub Release 说明由 Actions 按提交生成）。

### 2. 定版号 `$TAG`

1. 有 `$PREV`：解析 → `MAJOR.MINOR.PATCH`，按上表取下一号。
2. 无 `$PREV`：默认 `v0.1.0`（或人指定）。
3. 若需 major、跳号或人已指定覆盖 → **等人口头确认** `$TAG`（须 `vX.Y.Z`）。
4. 确认本地尚无同名 tag：`git rev-parse "$TAG" 2>/dev/null` 应失败。已存在且指向别的 commit → 停，问升 version 还是挪 tag；**禁止**默认 `--force`。

### 3. 写发版记录并登记索引

- 新建 `upgrades/$TAG.md`（文件名与 tag **完全一致**，含 `v`）。若尚无 `upgrades/`，本步创建目录与 `upgrades/README.md`。
- 在 `upgrades/README.md` 表格增加一行。
- **不要**把单篇 upgrades 登记进 `docs/doc_index.md`（发版说明不是开发文档）。
- 缺 `upgrades/$TAG.md` 时 **禁止** 打 tag。

体例：

```markdown
# vX.Y.Z

相对 `vA.B.C`：一句话说明本版相对上一 tag 的主题。
（首发：本仓首个发版。）

## 变更

- …

## 升级注意

- 桌面安装包在 GitHub Release 页，由 Actions 在 tag 推送后上传
- 不要删除 Release 上的 `latest*.yml` 与 blockmap，否则已安装客户端无法更新
- 核对 `package.json` 的 `version` 为 `X.Y.Z`（不含 v）
```

### 4. 对齐版本号

- 编辑 `package.json` 的 `version`，设为 `$TAG` 去掉前缀 `v`。CI 会核对它与 tag 一致。

### 5. 本地提交并打 tag

```bash
git add "upgrades/${TAG}.md" upgrades/README.md package.json
git commit -m "$(cat <<EOF
chore(release): 对齐 ${TAG} 版本并记录发版说明

EOF
)"
git tag "$TAG"
```

仅当还有未提交的功能代码且人要求一并入库时，才额外 `git add` 那些路径。

### 6. 推送 tag

默认只把下列命令交给用户执行。**仅当用户本轮明确要求代推**时 Agent 才执行。

```bash
git push origin main
git push origin "$TAG"
```

分支名若非 `main`，换成当前默认分支。推送 tag 后到 Actions 看「Build All Platforms」。完成后 Releases 页应出现 `$TAG`，并带有各平台安装包、`latest*.yml` 与 blockmap。

不要执行 `gh release create`，也不要打开网页新建 Release。

### 7. 验收

- 远程存在 tag `$TAG`
- `package.json` 的 `version` 等于 `$TAG` 去掉 `v`
- Actions 成功后，GitHub Release 含安装包与 `latest*.yml`

## 产物

- `upgrades/$TAG.md` + `upgrades/README.md` 索引行（入库，仓内记录）
- 更新后的 `package.json` `version`
- 本地与远程 lightweight tag `$TAG`
- GitHub Release（由 Actions 创建；标题 = `$TAG`；说明按提交生成；资产为安装包）

## 失败排查

| 现象 | 处理 | 禁止 |
|---|---|---|
| 可能升 major | 「是否 breaking？目标 major tag 是？」 | Agent 自行打 `v1.0.0` / `v2.0.0` |
| 跳号 | 等人显式指定目标 `$TAG` | 默认跳号 |
| 缺 `upgrades/$TAG.md` | 先写再 tag | 空记录打 tag |
| tag 已存在且指向别的 commit | 问升版还是挪 tag | 默认 `--force` |
| staged 含 `.env` | 立刻中止 | 带着密钥 push |
| 想本地建 Release | 停。等 Actions 的 release job | `gh release create` 或网页 Publish release |
| CI 报 tag 与 version 不一致 | 改 `package.json` 的 `version` 后重新发版，不要强行复用已失败的 tag | 在 CI 里改版本号 |
| 用户未授权代推 | 只输出推送命令并停 | 静默 push |

## 测试

手工验收（无自动化单测）：

```bash
TAG=v0.1.0   # 换成本版
test -f "upgrades/${TAG}.md"
git rev-parse "$TAG"
node -p "require('./package.json').version"   # 应等于 ${TAG#v}
# Actions 完成后：
gh release view "$TAG"
```
