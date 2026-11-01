import { useCallback, useEffect, useRef, useState } from 'react';

type Props = {
  value: number;
  onChange: (height: number) => void;
  min?: number;
  max?: number;
};

/** 水平分隔条：向上拖增高底部面板 */
export function HorizontalResizeHandle({ value, onChange, min = 120, max = 560 }: Props) {
  const startY = useRef(0);
  const startHeight = useRef(0);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      startY.current = e.clientY;
      startHeight.current = value;
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
      const delta = startY.current - e.clientY;
      onChange(Math.min(max, Math.max(min, Math.round(startHeight.current + delta))));
    },
    [dragging, max, min, onChange],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) {
        return;
      }
      setDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    },
    [dragging],
  );

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const prev = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = prev;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging]);

  return (
    <div
      className={`wf-h-resize-handle${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="horizontal"
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
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          onChange(Math.min(max, Math.max(min, value + step)));
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          onChange(Math.min(max, Math.max(min, value - step)));
        }
      }}
    />
  );
}
