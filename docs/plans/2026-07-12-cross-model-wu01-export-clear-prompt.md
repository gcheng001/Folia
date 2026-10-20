# Cross-model Work Unit WU-01: Mind Map Export + Clear Free Lines

Repository: `/Users/Apple/Folia-source`
Mode: `live_takeover`
Target branch: `gaocheng/v0.4-integration`

You are working in an isolated candidate worktree that has the user's current dirty mind-map implementation synced in. Do not edit the user's main worktree. Do not install apps, push, open PRs, or run destructive git commands. Do not commit.

Source contract:
- PRD: `/Users/Apple/Folia-source/docs/plans/PRD-mindmap-export-and-clear-free-lines.md`
- Issue: `https://github.com/gcheng001/Folia/issues/2`

Acceptance slice:
- Fix mind map PNG/PDF export so it works for a canvas containing normal nodes, annotation groups, custom node-to-node edges, free arrows/line segments, node colors, and node sizes.
- Export bounds must include free line endpoints, including bound endpoints resolved from current node boxes.
- Exported output must not include editor chrome such as toolbar, context bar, controls, handles, selection rings, or editing inputs.
- Add a one-click toolbar action to clear only user-drawn free arrows/line segments (`freeLines`), not tree edges, custom node-to-node edges, annotation groups, nodes, colors, sizes, or edge display mode.
- Clear action must record history so undo restores free lines and redo clears them again.
- Clear action must clean selected IDs that point to removed free lines.
- Update user-visible changelog and tests.

Relevant files:
- `src/components/mindmap/MindMapPane.tsx`
- `src/components/mindmap/MindMapToolbar.tsx`
- `src/components/mindmap/FreeFlowLayer.tsx`
- `src/components/mindmap/SelectionContextBar.tsx`
- `src/components/mindmap/exportImage.ts`
- `src/components/mindmap/MindMapPane.features.test.tsx`
- `src/components/mindmap/exportImage.test.ts`
- `src/services/mindmap/freeFlow.ts`
- `src/services/mindmap/canvasSidecar.ts`
- `CHANGELOG.md`

Suggested checks:
- `npm run typecheck`
- `npm test -- --run src/components/mindmap/exportImage.test.ts src/components/mindmap/MindMapPane.features.test.tsx src/services/mindmap/freeFlow.test.ts src/services/mindmap/canvasSidecar.test.ts --reporter dot`

Return:
- concise summary
- changed files
- tests run and results
- any candidate patch notes or remaining risks
