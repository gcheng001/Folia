# 脑图视图（用脑图打开）设计方案

- **日期**：2026-07-11
- **状态**：已评审（grilling 全程走完，11 个决策逐一钉死）
- **来源**：澄脉（Chengmai）项目转向。原独立脑图 App 方案经评审推翻，脑图能力并入 Folia，澄脉封存（见澄脉仓库 ADR-0004）。

## 1. 背景与动机

用户核心诉求（VS Code markmap 插件同款体验）：

1. Markdown 文件默认正常打开，可选择"用脑图打开"切换为脑图视图；
2. 脑图可编辑，编辑结果随时写回文件——**文件就是那份 MD，不存在第二份数据**；
3. 首个旗舰场景：`prepare-hearing-record` skill 生成的《庭审记录》MD 直接以脑图形式使用（取代"导入 WPS 生成思维导图"）。

Folia 是承载这件事的正确宿主：定位即法律文档 Markdown 工具，已有多标签会话、分屏、草稿保护、右侧按需面板等全部地基。

## 2. 已锁定决策（评审记录）

| # | 决策点 | 结论 | 关键代价（已接受） |
|---|--------|------|--------------------|
| 1 | MD 的地位 | **MD 即源**（markmap 式）：MD 是脑图的唯一权威文件 | 领域字段靠 MD 约定语法承载 |
| 2 | 节点坐标 | **尽力保存手拖坐标**：sidecar 按节点内容路径匹配，失配回退自动布局 | 节点重命名后丢该节点手拖坐标 |
| 3 | 树结构语法 | **标题+列表混合**（markmap 约定，与庭审记录模板零磨合） | — |
| 4 | 领域字段编码 | **Obsidian 原生语法**（#标签 / [[wiki]] / 缩进段落备注 / 三性文本模式） | 固定词表标签与自由标签共用语法 |
| 5 | 关联线 | **行内站内链接** `[[#目标]]`（他文件链接=引用，本文件锚=关联线） | 目标改名断链（画布内改名自动联动） |
| 6 | 保存语义 | **跟 Folia 宿主**：显式 Cmd+S + 草稿保护；文件监听热重载为后续增强 | 推翻早期"Obsidian 式自动写盘"设想 |
| 7 | 应用形态 | **嵌入 Folia**，不做独立 App | — |
| 8 | 澄脉存续 | **并入 Folia、澄脉封存**：画布层移植、领域文档迁移、仓库归档 | 放弃独立 App 可能性 |
| 9 | 嵌入形态 | **整标签切换先行**：`EditorMode` 增 `'mindmap'`；右侧伴随面板留作后续 | 首期无"边看 MD 边看图" |
| 10 | v1 范围 | **全量编辑一步到位**：结构编辑 + 类型/标签/引用/关联线/三性完整编辑 UI | 首期战线较长 |
| 11 | 视觉基调 | **跟 Folia 极简同色**：中性色 + 单强调色，类型用细徽标承载 | 不做彩虹分支 |

## 3. MD ↔ 脑图映射规范（v1）

### 3.1 树结构（标题+列表混合）

- 单个 H1 → 根节点；无 H1 或多个 H1 → 以文件名为虚拟根，H1 们作一级节点。
- H2–H6 按层级嵌套于最近的更浅标题之下。
- 标题之下的无序/有序列表：列表项 = 子节点，嵌套列表继续加深。
- 与 `prepare-hearing-record` 模板实测对齐：`# 庭审记录` 根 → `## 一、案件信息` 一级 → `### 案号` 二级 → `- __________` 叶子。

### 3.2 非大纲内容 → 备注（无损往返的关键）

段落、代码块、表格、引用块等不构成大纲的块，一律挂为**最近节点的备注**，原文保留：

- 标题节点：标题之后、第一个子标题/列表之前的块 → 该节点备注；
- 列表项节点：列表项内的后续行/块 → 该列表项备注。

**往返不变式**：`serialize(parse(md))` 对未经画布编辑的区块**逐行保持原文与顺序**。实现上 parser 保留每节点的原始 Markdown 片段（CST 式），序列化时未变更节点原样拼回。这是打开任意 Obsidian 长笔记不丢内容的保证，用往返 diff 测试兜底。

### 3.3 领域字段（Obsidian 原生语法）

| 字段 | 语法 | 说明 |
|------|------|------|
| 节点类型 | 行内 `#要件 #争点 #证据 #法条 #事实 #质证` | 固定词表识别为类型；词表外的 `#xx` 为自由标签 |
| 标签 | 行内 `#重点 #待核实` | Obsidian 可搜索 |
| 引用 | `[[其他文件]]` / `[[其他文件#锚]]` | 挂外部指向（Obsidian 笔记、案件材料） |
| 关联线 | `[[#本文件内锚]]` | 源=所在节点，目标=锚指向节点；同名歧义取文档序第一个，精确可用 `[[#父标题/子标题]]` 路径式 |
| 备注 | 节点下缩进段落/后续块 | 见 3.2 |
| 质证三性 | `- 真实性：认可` 文本模式 | 状态词表：认可 / 不认可 / 部分认可；`真实性/合法性/关联性` 三项识别 |

### 3.4 布局 sidecar

- 手拖坐标、折叠状态、视口存**应用数据目录**（键 = 文件绝对路径 + 节点内容路径），不在用户文档目录留 sidecar 文件、不进 git。
- 内容路径示例：`庭审记录/四、原告举证/借条`。失配（节点改名/移动）→ 该节点回退自动布局，无害。
- sidecar 整体可丢弃，丢弃后全图自动布局重建——布局永远不是数据。

## 4. 架构与移植

```
src/services/mindmap/          纯函数内核（零 React 依赖，Vitest TDD）
  ├── types.ts                 MindMapDoc / MindNode（领域结构）
  ├── parser.ts                markdown → MindMapDoc（CST 保留）
  └── serializer.ts            MindMapDoc → markdown（未变更区块原样拼回）

src/components/MindMapPane.tsx 画布组件（自澄脉移植，自包含）
  内部：React Flow 画布 + d3-hierarchy 自动布局 + zustand 内部状态
  对外：props = { markdown, onChange(markdown) }，与 Folia 只交换 MD 字符串
```

- `session.ts`：`EditorMode` 增 `'mindmap'`；工具栏加"脑图"切换按钮（快捷键建议 `Cmd+Alt+G`，与既有 `Cmd+Alt+S/P` 系列一致）。注：`Cmd+Alt+M` 已被微信预览占用（AppLayout keydown handler），脑图不可复用；取 G（Graph/图）。
- 保存/草稿/脏标记：画布任何编辑 → serialize → 更新 tab 内容字符串 → 走与源码模式完全相同的 dirty→Cmd+S 管线。**不发明新保存机制。**
- 自澄脉移植清单：`MindMapCanvas` / `CustomNode` / `CustomEdge` / `layoutAlgorithm` / `navigationAlgorithm` / 键盘导航（Enter 兄弟、Tab 子节点、方向键移动）/ 庭审模板（转为 MD 模板文件）。
- 澄脉不再移植的部分：IndexedDB 存储、PWA、菜单栏、独立文件操作、MCP server 计划（Agent 直接写 MD 文件即完成联动）。
- 新增依赖：`@xyflow/react` v12、`d3-hierarchy`、`zustand`（组件内部用，不外泄到 Folia 状态层）。

## 5. 视觉规范（遵循 docs/DESIGN.md）

- 默认「经典树」：深色实心根节点 + 浅灰圆角子节点；连线采用水平主干、共享竖干、圆角直角支路。经典树隐藏点阵背景与 MiniMap，保持干净画布；蓝/彩/紫/黑白描边直线主题作为备选。
- 可编辑节点允许自由拖动；拖动仅改变 sidecar 坐标，不改变 Markdown 标题/列表层级。坐标以文件路径 + 节点内容路径为键，重命名失配时回退自动布局。
- 节点类型徽标：节点左侧细色条 + 小字徽标（画布上唯一的低饱和彩色元素）。
- 关联线：虚线 + 箭头，与父子边明确区分。

## 5.5. 画布扩展实现说明（v0.5+）

围绕 §2 决策点 1（MD 即源）与 §3.4（sidecar 边界）扩展了完整的
「脑图 + 流程图」画布。所有能力都遵循同一个权威/边界规则：

### 5.5.1 数据流

- **Markdown**：始终是文档/结构的唯一源。任何会改变大纲结构、移动子树、
  删除节点、改变文字的操作都先调用 `services/mindmap/edit.ts` 中的
  行级手术函数，返回新 MD → `onChange(md)` → 父组件重解析 → 重渲染。
  画布从不持有第二份文档状态。
- **画布 sidecar**（`services/mindmap/canvasSidecar.ts`）：单一 JSON 文档，
  localStorage 键 `folia.mindmap.canvas.v2:<documentKey>`。包含
  `positions / customEdges / groups / edgeMode / colorHistory`。
  按文件隔离，节点重命名/移动导致 content-path 失配时，相关 key 自然
  失效、自动布局接管（与设计文档 §3.4 一致）。
- 同时为兼容 v1 positionStore，仍然把 `positions` 镜像写一份到旧 key
  （`folia.mindmap.positions.v1:`），旧画布切换过来不丢坐标。

### 5.5.2 交互矩阵

| 能力 | 触发 | 数据归属 | 可撤销 |
|------|------|----------|--------|
| 节点编辑（Enter/Tab/Shift+Tab/Space/F2/Delete） | 画布聚焦 | MD | 是（历史栈） |
| 自由拖动 | 鼠标拖到画布空白 / Alt+拖动 | sidecar.positions | 是（拖动产生 position change 也推历史） |
| 结构拖动 | 拖到目标节点中央停留 400ms | MD（`moveSubtreeAsLastChild`）+ sidecar 清掉被移子树旧坐标 | 是 |
| 多选 | Shift+单击 / Cmd/Ctrl+A / Shift+拖动 | 画布 transient 状态 | 否（属于选择层） |
| 对齐/等间距 | 工具栏 → 选中多个 | sidecar.positions | 是 |
| 自动布局 | 工具栏「自动布局」 | 清空 sidecar.positions | 是 |
| 连接线模式 | 工具栏「脑图线 / 流程箭头 / 无连接线」 | sidecar.edgeMode | 是 |
| 自定义流程箭头 | 工具栏「连接」+ 从节点 handle 拖到另一节点 | sidecar.customEdges | 是 |
| 删除连线 | 选中后 Delete / 上下文栏 ✕ | sidecar.customEdges | 是 |
| 标注框 | 选中多个 → 工具栏「添加标注框」 | sidecar.groups | 是 |
| 拖动框 | 框整体拖动 → 平移成员节点 | sidecar.positions | 是 |
| 删除框 | Delete / 上下文栏 ✕ | sidecar.groups | 是 |
| 框样式（实/虚/颜色/粗细/填充/圆角） | 上下文栏 SegBtn / 调色板 | sidecar.groups[].style | 是 |
| 节点/箭头/框颜色 | 上下文栏 6-8 常用色 + 自定义 + 最近用 | 各自 style.color | 是 |
| 导出 PNG | 工具栏「导出」→ PNG | 一次性 PNG Blob → Tauri 原生 save 写盘 | 否 |
| 导出 PDF | 工具栏「导出」→ PDF | 一次性 PDF Blob → Tauri 原生 save 写盘 | 否 |

### 5.5.3 撤销/重做

- 内部栈：上限 64 条 `{markdown, sidecar}` 快照。任何会改变 MD 或
  sidecar 的可撤销操作都先 `pushHistory` 再提交。Cmd/Ctrl+Z 撤销、
  Cmd/Ctrl+Shift+Z / Cmd/Ctrl+Y 重做。工具栏的撤销/重做按钮同步
  启用态（`canUndo` / `canRedo`）。

### 5.5.4 结构拖动的合法性护栏

| 条件 | 行为 |
|------|------|
| source 是根 | 拒绝（结构不变，坐标自由） |
| source === target | 拒绝 |
| target 在 source 子树内（环） | 拒绝 |
| source.kind !== target.kind（heading↔list 跨种） | 拒绝 |
| heading 子树平移后最深层级 > 6 | 拒绝（Markdown 上限） |
| 松手时未在目标中心停留 ≥ 400ms - 30ms 容差 | 退化为自由拖动，仅更新坐标 |
| 按住 Alt/Option 拖动 | 始终退化为自由拖动，不进入结构预览 |

### 5.5.5 导出实现

- PNG：`html2canvas` 截 `.react-flow__viewport`，2x 高清，可选 1x/2x
  倍率（实际目前 UI 提供 1x/2x，4x 在 scale 参数上调即可）。背景可
  选白/透明。
- PDF：`html2pdf.js`（已在 dependencies）套白底，强制 A4 横向。
- 两者都走 Tauri 原生 `save` 对话框 + `writeFile` 落盘；浏览器环境
  fallback 到 a[download]（见 `services/exportTauri.ts`），保证 Web 预览
  与 Tauri 桌面一致。
- 导出范围严格按 `computeExportBounds`：取所有节点 + 边的真实包围盒
  + 16px 余量，不裁切。隐藏线（`edgeMode='none'`）不出现，标注框
  / 自定义箭头出现。UI 元素（选择框、handle、工具栏、上下文栏、编辑
  输入框）不在 `react-flow__viewport` 子树里，不被截到。

### 5.5.6 关键文件清单

```
src/services/mindmap/canvasSidecar.ts        画布 sidecar 存储（v2）
src/services/mindmap/align.ts                对齐/等间距纯函数
src/services/mindmap/edit.ts                 +moveSubtreeAsLastChild
src/services/mindmap/positionStore.ts        v1 兼容（v2 镜像写入）
src/services/exportTauri.ts                  导出/保存 Tauri 壳
src/components/mindmap/MindMapPane.tsx       画布主组件（重写）
src/components/mindmap/MindMapToolbar.tsx    工具栏
src/components/mindmap/SelectionContextBar.tsx 上下文样式栏
src/components/mindmap/AnnotationGroupNode.tsx 标注框节点
src/components/mindmap/CustomFlowEdge.tsx    自定义流程箭头
src/components/mindmap/exportImage.ts        PNG/PDF 导出
```

## 6. 里程碑

| 阶段 | 内容 | 验收 |
|------|------|------|
| M-A | 解析/序列化内核 | 庭审模板 + 真实笔记 fixtures 往返 diff 为空；`parse∘serialize` 幂等。**必备 fixture**：肖永吉案实战庭审脑图（2026-07-09 庭上实录，165 节点 / 5 层深，`km2md.py` 转出的 MD），含庭上临时插入的一级节点（"回应""保险公司质证"与编号章节平级），检验真实混乱结构 |
| M-B | 画布移植 + 只读渲染 | React Flow × React 19 spike 通过；庭审记录 MD 完整渲染（十个一级节点+三性）；折叠/导航/缩放可用 |
| M-C | 结构编辑回写 | 画布增删改/重排 → Cmd+S → git diff 仅预期行变化 |
| M-D | 领域字段全量编辑 UI | 右键菜单+属性面板：类型/标签/引用/关联线绘制/三性快捷设置 |
| M-E | 手拖坐标 sidecar | 拖动持久化；外部改 MD 后失配节点优雅回退 |
| M-F | 增强（后续） | 文件监听热重载（Agent 联动体感）、右侧伴随面板模式、"新建庭审记录"模板入口 |

配套动作：澄脉仓库补 ADR-0004 + README 封存指引；领域术语（节点类型/质证三性/关联线等）以本文 3.3 为权威，后续按需并入 Folia 文档体系。

存量迁移：用户既有 VS Code mindmap 插件的 `.km`（KityMinder JSON）资产，用现成 `~/.claude/scripts/km2md.py` 一次性转 MD 即可（根→H1、分支→标题、叶子→列表项，与本方案 3.1 语法兼容），Folia 不内建 `.km` 导入。历史教训：`.km`+手动同步脚本的模式已实际发生"MD 停在旧快照"事故（肖永吉案 MD 落后脑图 100 分钟），这正是 MD 即源要消灭的问题。

## 7. 风险与对策

- **React Flow v12 × React 19 兼容**：M-B 第一步做 spike，不通过则评估 pin 版本或替代渲染层。
- **序列化保真**：CST 保留策略 + fixtures 兜底；任何"识别不了"的结构宁可整块当备注也不丢。
- **Vditor/源码/脑图三模式内容同步**：统一以 tab 的 Markdown 字符串为唯一交换介质，沿用 wysiwyg↔source 现成切换管线。
- **快捷键冲突**：脑图模式内画布接管编辑键，全局键（Cmd+S/O/W、标签切换）沿用 Folia。

## 8. 当前实现状态（v0.4.7）

### 8.1 数据存储

- **localStorage 存储**：画布 sidecar 使用 `folia.mindmap.canvas.v2:<documentKey>` 键存储于浏览器 localStorage，不是应用数据目录文件。按文件绝对路径隔离，节点重命名/移动导致 content-path 失配时，相关 key 自然失效、自动布局接管。
- **v1 兼容**：`positions` 镜像写一份到 `folia.mindmap.positions.v1:` 键，旧画布切换过来不丢坐标。

### 8.2 NodeRef 身份与 Dangling 规则

- **身份映射**：节点 ID 为 `n{lineIndex}`（如 `n0`, `n1`），customEdges 和 groups 的 memberIds 使用稳定的 positionKey（节点内容路径，如 `庭审记录/四、原告举证/借条`）。
- **Dangling 处理**：节点重命名/移动后，旧的 positionKey 失配。组件内通过 `buildPositionKeyMap` 将 positionKey 映射回当前的 `n{lineIndex}`，找不到则清理 dangling 引用（不渲染或隐藏）。

### 8.3 Schema 迁移

- **v1 → v2**：首次加载 v1 兼容数据时，合并 `positions` 到 v2 sidecar。迁移完成后标记，避免重复迁移。
- **幂等性**：重复加载同一文档不会重复迁移，文件隔离保证不同文件的 sidecar 独立。

### 8.4 撤销/重做

- **历史栈**：内部栈（上限 64 条）存储 `{markdown, sidecar}` 快照。
- **事务边界**：每次会改变 MD 或 sidecar 的操作形成一次 undo 事务。自由拖动、结构拖动、对齐等均形成独立事务。

### 8.5 导出实现

- **全画布裁剪**：`computeExportBounds` 计算所有节点 + 边 + 标注框的真实包围盒 + 16px 余量，与 viewport 平移/缩放无关。
- **UI 排除**：导出时自动排除 toolbar、context bar、React Flow Controls、选择轮廓、handles、editing input（不在 `.react-flow__viewport` 子树内）。
- **PNG/PDF**：PNG 支持 1x/2x 倍率和白底/透明底选择，PDF 固定白底。
- **错误处理**：Tauri save/write 失败抛出错误并在 MindMapPane 显示可理解提示，Web fallback 只使用 basename（不把绝对路径当下载文件名）。

### 8.6 结构拖动合法性护栏

- **中央区域检测**：只有进入节点中央区域（内缩 20%）才开始 400ms 确认计时。
- **确认高亮**：确认前后有明显不同高亮（预告 vs 确认），提示文本包含"设为『目标』的子节点"。
- **临时连接线**：显示虚线箭头预览，确认后变绿色实线。
- **Alt/Option 强制自由**：按住 Alt/Option 拖动始终退化为自由拖动，不进入结构预览。

### 8.7 删除键逻辑

- **编辑态**：input/textarea/contenteditable 编辑态 Delete 只删文字（浏览器原生处理）。
- **单选**：节点/边/框 均可删除。
- **多选**：只删除边和框，不删除节点。
- **根节点保护**：根节点不允许删除。

### 8.8 状态管理

- **单一受控状态**：React Flow 的 nodes 和 edges state 直接使用 allNodes/allEdges 作为唯一来源，避免状态竞争。
- **Group 拖动**：使用 `rf.getNodes()` 获取最新节点位置，不依赖旧 closure 累加偏移。
- **Undo 事务**：free/group drag 均形成一个 undo 事务。

## 9. 后续增强（v0.5+）

- **Schema 版本化**：引入 `schemaVersion` 字段，支持无损升级。
- **MindMapPane 拆分**：抽离 history/document hydration 或 export controller/graph projection，明确状态所有权。
- **文件监听热重载**：Agent 联动体感。
- **右侧伴随面板模式**：边看 MD 边看图。
