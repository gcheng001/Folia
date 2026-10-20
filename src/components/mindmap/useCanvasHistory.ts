import { useCallback, useRef, useState } from 'react';
import type { MindMapCanvasSidecar } from '../../services/mindmap/canvasSidecar';

export interface CanvasSnapshot {
  markdown: string;
  sidecar: MindMapCanvasSidecar;
}

function cloneSnapshot(snapshot: CanvasSnapshot): CanvasSnapshot {
  return structuredClone(snapshot);
}

export function useCanvasHistory(limit = 64) {
  const undoRef = useRef<CanvasSnapshot[]>([]);
  const redoRef = useRef<CanvasSnapshot[]>([]);
  const [, refresh] = useState(0);
  const notify = useCallback(() => refresh((value) => value + 1), []);

  const recordBefore = useCallback((snapshot: CanvasSnapshot) => {
    undoRef.current = [...undoRef.current, cloneSnapshot(snapshot)].slice(-limit);
    redoRef.current = [];
    notify();
  }, [limit, notify]);

  const undo = useCallback((current: CanvasSnapshot): CanvasSnapshot | null => {
    const restored = undoRef.current.pop();
    if (!restored) return null;
    redoRef.current = [...redoRef.current, cloneSnapshot(current)].slice(-limit);
    notify();
    return cloneSnapshot(restored);
  }, [limit, notify]);

  const redo = useCallback((current: CanvasSnapshot): CanvasSnapshot | null => {
    const restored = redoRef.current.pop();
    if (!restored) return null;
    undoRef.current = [...undoRef.current, cloneSnapshot(current)].slice(-limit);
    notify();
    return cloneSnapshot(restored);
  }, [limit, notify]);

  const reset = useCallback(() => {
    undoRef.current = [];
    redoRef.current = [];
    notify();
  }, [notify]);

  return {
    recordBefore,
    undo,
    redo,
    reset,
    canUndo: undoRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
  };
}
