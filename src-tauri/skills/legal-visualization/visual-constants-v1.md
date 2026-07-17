# Folia 内置法律视觉常量 v1

来源:`cat-xierluo/legal-skills` 的 `legal-visualization`,上游版本 `v0.6.14`,
核对提交 `48aedb4a62a15b338f0ed86976401c0a94d0d3a2`。本文件内化上游
`references/legal-visual-constants.md` 的全部数值,并把 drawio 的 shape 字段去掉(因
Folia 不生成 .drawio),保留调色板、字体、节点尺寸、线型状态、画布原点供前端布局、
渲染、CSS 共用。运行时只读本文件,不依赖任何已安装 Skill。上游许可证为 CC-BY-NC
(见 `THIRD_PARTY_LICENSES/legal-skills-CC-BY-NC.txt`),Folia 与上游为同一作者授权
复用,决策记录见 `docs/adr/0022-internalize-legal-visualization-knowledge.md`。

抽取人/抽取日:Folia 开发,2026-07-17。上一版为 v0.6.14 内 4 字段;本次新增一图一观点
要求(`main_view`)与 relations[].status 五态,与 references/legal-visual-constants.md
一致。

## 设计原则(进入 build_skill_visual_prompt v4)

- **一图一观点**:每张图服务一个核心观点,颜色与线型必须服务该观点。
- **颜色含义优先**:所有颜色都是语义符号,不是装饰;同主体同色,同状态同型,
  争议/风险用强调色,缺失用灰色。
- **强调色不超 3 个**:主蓝 + 决策橙 + 争议红灰。本文件只定义 4 个色板值。

## 页面与画布

```yaml
page:
  paper: A4
  orientation: portrait
  margin_cm: { top: 2.54, bottom: 2.54, left: 3.18, right: 3.18 }
  usable_width_cm: 14.64
  dpi: 260
  origin: { x: 60, y: 80 }  # 节点坐标起始偏移,前端 SVG 布局用此偏移保证坐标系与上游一致
  min_gap_px: 60            # 节点最小水平/垂直间距
```

## 字体

```yaml
font:
  family: "Microsoft YaHei, SimHei, PingFang SC, sans-serif"
  size_title_pt: 24     # 图表主标题
  size_subtitle_pt: 14  # 副标题、结论栏
  size_node_pt: 14      # 节点正文
  size_caption_pt: 12   # 注释、证据编号
  size_legend_pt: 10    # 图例、技术标注
```

## 调色板(12 色,CSS 变量)

```yaml
palette:
  primary: "#1f77b4"               # 主色:同主体、合同主线、确认事实
  primary_light: "#E3F2FD"         # 主色浅底:节点填充
  accent_decision: "#FF8C00"       # 强调-决策:菱形/判断节点
  accent_decision_light: "#FFF3E0"
  accent_dispute: "#C0392B"        # 强调-争议:争议事实、违约、风险
  accent_dispute_light: "#FDECEA"
  grey_missing: "#9E9E9E"          # 缺失/待补充/未提及
  grey_missing_light: "#F5F5F5"
  line_solid: "#333333"            # 已证关系实线
  line_dashed: "#666666"           # 主张/推定虚线
  line_dotted: "#9E9E9E"           # 推定/待证点线
  text_primary: "#1a1a2e"          # 主文字色
  text_caption: "#757575"          # 注释/小字色
  frame: "#BDBDBD"                 # 容器/泳道边框
  frame_bg: "#F5F5F5"              # 容器/泳道底色
```

## 线型与状态绑定(进入校验)

| relations[].status | 视觉表达                          | 颜色                    | 标签前缀  |
|--------------------|-----------------------------------|-------------------------|-----------|
| `confirmed`        | 实线、常规色                       | `line_solid`            | 无        |
| `disputed`         | 虚线、强调色                       | `accent_dispute`        | "争议"    |
| `asserted`         | 虚线、主张方颜色                   | `primary`               | "主张"    |
| `inferred`         | 点线、浅色                         | `line_dotted`           | "推定"    |
| `missing`          | 灰色、问号、待补充标签             | `grey_missing`          | "待补充"  |

缺省(AI 未填)=`confirmed`,允许降级但不允许五态以外的值。

## 节点尺寸参考(布局引擎按节点数分档)

| 节点数  | 节点宽 | 节点高 | 水平间距 | 垂直间距 |
|---------|--------|--------|----------|----------|
| 1-7     | 160    | 70     | 220      | 160      |
| 8-15    | 140    | 60     | 180      | 130      |
| 16+     | 120    | 50     | 150      | 110      |

中文节点宽度 = `字符数 × 16px`,最小宽度 = 节点宽 × 1.3,最大不超过 350px。
字符高度 = 节点高(行数限制为 3 行,超出截断并加 `…`)。

## Folia 端字段映射

- `palette.*` → `src/services/visualization/legalVisuals.ts` 的 `LEGAL_PALETTE`,
  再 export 为 CSS 变量 `--legal-*` 注入 `.visual-workbook` scope。
- `font.*` → `legalVisuals.ts` 的 `LEGAL_FONT_SIZES`,CSS 直接 `font-size`。
- `node_sizing` → `legalVisuals.ts` 的 `nodeSizing(nodeCount)` 纯函数。
- `relations_status` → `legalVisuals.ts` 的 `EDGE_STATUS_STYLES` 表,渲染层
  按 status 选 stroke/dash/label prefix。
- `origin` → `layout.ts` 在 ELK 布局后做 `translate(+60, +80)` 平移。

## 修改记录

| 日期       | 变更                                          | 版本 |
|------------|-----------------------------------------------|------|
| 2026-07-17 | 内化自上游 v0.6.14(commit 48aedb4)            | 1.0  |