# Skill 来源与许可记录

> 核对时间：2026-07-13
> 核对对象：本机 `/Users/Apple/.shared-skills/baoyu-diagram/`

## 一句话结论

已经找到可核验的公开上游：`JimLiu/baoyu-skills`。上游仓库使用 MIT 许可证，允许使用、修改和分发；Folia 集成时必须锁定版本，并保留版权声明与 MIT 许可证全文。

## 一、公开上游

| 项目 | 核对结果 |
|------|----------|
| 上游仓库 | `https://github.com/JimLiu/baoyu-skills` |
| Skill 路径 | `skills/baoyu-diagram/` |
| 上游版本 | `1.117.3` |
| 核对时 main 提交 | `6b7a2e417500561a5ecdd0b168332f4142584617` |
| 许可证 | MIT License |
| 版权声明 | Copyright (c) 2026 Jim Liu |

上游仓库的 `LICENSE` 明确允许使用、复制、修改、合并、发布、分发、再许可和销售副本，条件是软件副本或重要部分中保留版权声明与许可文本。

## 二、本机副本与上游的对应关系

对本机文件和上述 main 提交的公开文件逐项比较：

| 文件 | 结果 |
|------|------|
| `references/architecture.md` | 完全一致 |
| `references/flowchart.md` | 完全一致 |
| `references/sequence.md` | 完全一致 |
| `references/structural.md` | 完全一致 |
| `scripts/main.ts` | 完全一致 |
| `SKILL.md` | 正文一致；本机缺少 `version: 1.117.3`，描述字段多了“宝玉,”前缀并使用引号 |

因此，可以合理确认本机 `baoyu-diagram` 来自该公开上游，而不是名称相同但来源不明的另一份文件。

## 三、Folia 可以怎样使用

进入产品接入时应当：

1. 固定使用版本 `1.117.3` 或固定提交 `6b7a2e417500561a5ecdd0b168332f4142584617`，不要直接跟随会变化的 main 分支。
2. 在 Folia 的第三方许可文件或安装包中保留 `Copyright (c) 2026 Jim Liu` 与 MIT 许可证全文。
3. 记录 Folia 对 Skill 做过的修改，避免以后无法区分上游内容和本项目定制内容。
4. 第一版只需要生成自包含 SVG。如果不提供 PNG 转换，就不要打包 `scripts/main.ts`，也不需要为它引入 `sharp` / Bun 运行时。
5. 如果以后确实打包 PNG 转换脚本，再单独核对脚本依赖的许可证与安装体积。

## 四、仍需用户确认的不是许可，而是效果

许可路径已经明确，当前真正的产品闸门是视觉效果：只有用户确认这些候选图明显优于 Folia 现有可视化，才进入完整产品接入。样图通过不代表 Folia 已经完成 Skill 集成。

---

> 本文件记录公开来源和许可证事实，不构成法律意见。产品发布前仍应把固定版本的 LICENSE 原文纳入第三方许可清单。
