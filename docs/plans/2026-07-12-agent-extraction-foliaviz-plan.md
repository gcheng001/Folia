# Agent 抽取通道 v1 — 实施计划

日期：2026-07-12。决策依据：`docs/adr/0004-agent-extraction-channel.md`，术语见 `CONTEXT.md`（抽取通道 / Agent 抽取 / 抽取规格 / 宽容导入）。

**状态**：✅ 全部 5 个工作项已交付（4 个 WU 提交 + 1 个已在主线）。隔离 worktree `cross-model-delivery/folia-agent-extract-20260712`，HEAD `ba02b3b`。

## 目标

工具栏新增「AI 可视化」入口：对当前 Markdown 标签，headless 唤起本机 claude CLI 按抽取规格生成 `.foliaviz` 写到源文档旁，Folia 检测到产物后经宽容导入自动打开为可编辑工作簿。本地「一键可视化」保持现状并冻结。

## 工作项（按依赖排序，全部完成）

### 1. 宽容导入（前置，纯 TS）— `7b6fc24` ✅

- `src/services/visualization/schema.ts`：新增 `importExternalWorkbook(input, sourceMarkdown)`。
- 规则：`excerptHash`、`start`、`end` 允许缺失或错误；以 `excerpt` 为准调用 `resolveSourceAnchor`（`source.ts` 已有）重新定位并补算三字段；定位 `missing`/`ambiguous` 的元素连同其 `excerpt` 降级为 `ReviewItem`（reason 分别用 `unsupported`/`ambiguous`），不整体拒绝。
- `rulesVersion` 接受任意非空字符串。
- 测试 331 行：合法产物全量定位、部分摘录失配降级、完全无锚点文件仍可打开（全部进待确认）。

### 2. 抽取规格 v1（版本化资源）— `9b15afa` 随 WU3 提交 ✅

- 位置：`src-tauri/extraction/spec-v1.md`，通过 `include_str!` 编译期打包；改规格必须升 `EXTRACTION_SPEC_VERSION`。
- 内容契约：输出为单个 `.foliaviz` JSON；每个元素必须携带 `excerpt` 原文精确引文（禁止改写）；视图家族限 6 个；文件名 `<源文件名>.foliaviz` 同目录。

### 3. Rust 命令：唤起 agent CLI — `9b15afa` ✅

- `src-tauri/src/lib.rs` 新增 `spawn_agent_extraction(source_path)` + `agent_extraction_status`，形态参照 `export_pdf_via_chrome`（spawn → 轮询 try_wait → 校验产物存在）。
- CLI 探测：PATH 上找 `claude`；找不到返回 `kind=cli_not_found`。
- 调用：`claude -p "<spec + 路径>" --permission-mode bypassPermissions --output-format text`，工作目录设为源文档所在目录；超时 5 分钟杀进程。
- 错误结构化返回：`cli_not_found | spawn_failed | timeout | agent_failed | ok`，前端按 kind 路由本地化文案。
- 单元测试：3 个（路径派生绝对/相对 + prompt 合约），全部通过。

### 4. 前端入口与状态 — `ba02b3b` ✅

- `Toolbar.tsx` 新增 Sparkles 图标按钮（紧邻一键可视化），运行中转圈；非 Markdown / 未保存 / 抽取中时禁用。
- `AiExtractionOverlay.tsx`：隐私确认遮罩，明确说明：调用本机 Claude CLI、产物落源文档旁、内容仅在本地进程内。
- `AppLayout.tsx` `handleConfirmAiExtract`：`invoke('spawn_agent_extraction')` → 读 `.foliaviz` → `importExternalWorkbook` → 新标签打开可编辑工作簿 → 弹窗告知降级元素数。
- 三类错误本地化提示：CLI 缺失、超时、agent 失败各走独立前缀。
- 快捷键 `Cmd+Alt+Shift+G`。
- i18n 14 个键 × 3 语言。
- 641/641 前端测试通过。

### 5. 冻结本地引擎 + 修星号 bug — `b350338` ✅

- `families.ts` `cleanBlockLabel` + 三个相关位置：剥除行内 Markdown 强调标记（`**`、`*`、`__`、`_`、`` ` ``、`~~`），迭代支持嵌套（**第*一*层** → 第一层）。
- 同时修复 `timeline()` 的 leading-punct 正则误吞 `*` 的潜在 bug。
- 16/16 families 测试通过、51/51 visualization 套件通过。
- 不再新增抽取规则。

## 门禁（已通过）

```bash
node_modules/.bin/vitest run --config config/vite.config.ts   # 641 / 641
node_modules/.bin/tsc -b config/tsconfig.json                 # clean
cd src-tauri && cargo test --offline --lib                   # 33 / 33
```

手工验收待办：用一份真实案件 Markdown 走完「AI 可视化 → 产物落盘 → 自动打开 → 画布可编辑 → 失配项出现在待确认侧栏」。这一步需要真实本机 Claude CLI 登录态，由用户在安装包中执行。

## 验收记录（2026-07-12，headless E2E）

用真实 claude CLI（2.1.197）按 `build_agent_prompt` 同款参数（`--permission-mode bypassPermissions --output-format text -p`，cwd=源目录）对样例借贷纠纷文书（含日期事件/箭头关系/编号步骤/pipe 表格）实测：

- 抽取约 1 分钟产出 13KB `.foliaviz`：5 sheet（structure-overview/timeline/relationship/flow/matrix）38 元素，schema 头部字段全部合规。
- `importExternalWorkbook` 导入：38/38 元素带 excerpt 锚点且全部重定位成功（`anchorsResolved=38`），`demotedCount=0`，标签零 `**`/`__` 残留。
- 降级路径实测：篡改一条 excerpt 后 `demotedCount=1`，元素移入 `reviewItems`（reason=unsupported），文件整体未被拒绝。
- 门禁复跑（vitest 子集 + typecheck + eslint + cargo test --lib）exit 0。

残留（不阻塞验收）：

1. `spec-v1.md` 说"源文已嵌入提示词、不要访问文件系统"，但 `build_agent_prompt` 实际只给路径、要求 agent 读盘写盘——实测 agent 按任务参数执行不受影响，spec-v2 时应改文案。
2. `AppLayout.tsx` `handleRequestAiExtract` 对未保存文件 alert 的是 `toolbarVisualizationTitle`（标题文案）而非"请先保存"提示。
3. `AiExtractionOverlay` / AI 按钮状态无专属单元测试（641/641 通过是因为没有测试覆盖它）。
4. GUI 点击链路（按钮→遮罩→自动开标签）未在真实窗口验证——已安装的 `/Applications` 包早于本轮 commit，需重新打包后由用户点验。

## 真机点验发现（2026-07-12 晚）

用户真机点击暴露 headless 验收测不到的环境 bug：**Finder/Dock 启动的 GUI app 只继承
launchd 精简 PATH，`locate_claude_cli` 只扫 env PATH 必然 `cli_not_found`**（claude 装在
`~/.npm-global/bin`，且该路径配在 `.zshrc`，连登录 shell 都看不到）。

修复（commit 见 git log `fix(ai-extract): GUI 启动时 PATH 精简`）：候选目录 = 登录 shell
PATH + 继承 PATH + 兜底目录（`~/.npm-global/bin`、`~/.claude/local`、`~/.local/bin`、
`/opt/homebrew/bin`、`/usr/local/bin`），locate 与 spawn 子进程 env 共用，OnceLock 缓存。
新增 4 个单测（37/37）。

## 用户体感反馈（2026-07-12 晚，二期优化输入）

修复 PATH 后链路已通，但用户反馈：**点「开始抽取」后只有转圈，约一分钟以上无任何进度
反馈，体验差**。v1 设计上只有「开始/完成/失败」三态（见 ADR-0004 与本计划"明确不做"），
真实使用证明这不够。二期候选方向（按预估收益排序）：

1. 流式进度：用 `--output-format stream-json` 消费 claude 的中间事件，在遮罩上显示
   「正在读取源文 / 正在生成时间线…」级别的阶段文案。
2. 后台化 + 可取消：抽取转入后台，状态条挂在标签页角落，随时可取消（Rust 端已有
   `cancelled` 分类，缺前端入口）。
3. 缩短感知时长：prompt 里直接内嵌源文内容省掉 agent 读盘往返；或允许选择更快的模型。

## 明确不做（v1）

- html-anything 宿主入口（C3，二期候选）、MyAgents 派发。
- claude 之外的 agent CLI。
- 生成过程流式展示、生成后追问迭代。
- 本地引擎新规则、PNG/PDF 导出管线改动。
