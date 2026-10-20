# Free flow lines are canvas objects, not node-only edges

Accepted. Folia will add **自由流程线** as first-class canvas objects whose endpoints may be free coordinates or snapped-and-bound node anchors, instead of stretching the existing node-to-node custom edge model to cover free drawing. This keeps Markdown hierarchy, node connections, and document-output diagram annotations separate, while allowing deterministic canvas tidying for length, direction, and arrow style.

**Considered Options**

- Reuse node-to-node custom edges for everything: simpler storage, but it cannot represent endpoints placed anywhere on the canvas and makes line length/direction depend on node layout.
- Add free flow lines as a separate sidecar object: slightly larger model, but it matches the user's flowchart authoring workflow and keeps the existing compatibility path intact.

**Consequences**

- The line tool should default to creating free arrows, while preserving node connection as a compatible advanced mode.
- Canvas tidying should be deterministic rather than model-generated: operate on the current selection, or the whole canvas when nothing is selected.
