import { useCallback, useEffect, useRef, useState } from 'react';

type Side = 'left' | 'right';

type Props = {
  side: Side;
  value: number;
  onChange: (width: number) => void;
  min?: number;
  max?: number;
};

/**
 * 拖拽调宽手柄。左侧手柄：向右拖变宽；右侧手柄：向左拖变宽。
 */
export function ResizeHandle({ side, value, onChange, min = 200, max = 560 }: Props) {
  const startX = useRef(0);
  const startWidth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      startX.current = e.clientX;
      startWidth.current = value;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [value],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) {
        return;
      }
      const delta = e.clientX - startX.current;
      const next =
        side === 'left' ? startWidth.current + delta : startWidth.current - delta;
      onChange(Math.min(max, Math.max(min, Math.round(next))));
    },
    [dragging, max, min, onChange, side],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) {
      return;
    }
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, [dragging]);

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const prev = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = prev;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging]);

  return (
    <div
      className={`wf-resize-handle wf-resize-handle-${side}${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 24 : 8;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onChange(Math.min(max, Math.max(min, value + (side === 'left' ? -step : step))));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onChange(Math.min(max, Math.max(min, value + (side === 'left' ? step : -step))));
        }
      }}
    />
  );
}
