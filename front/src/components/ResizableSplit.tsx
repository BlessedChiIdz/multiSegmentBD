import { Box } from '@mui/material';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type Direction = 'horizontal' | 'vertical';

interface ResizableSplitProps {
  direction: Direction;
  first: ReactNode;
  second: ReactNode;
  initialFirstSize: number;
  minFirstSize?: number;
  /** Absolute max, or capped by container minus minSecond */
  maxFirstSize?: number;
  storageKey?: string;
}

function readStoredSize(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export function ResizableSplit({
  direction,
  first,
  second,
  initialFirstSize,
  minFirstSize = 120,
  maxFirstSize = 2000,
  storageKey,
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [firstSize, setFirstSize] = useState(() =>
    storageKey ? readStoredSize(storageKey, initialFirstSize) : initialFirstSize,
  );
  const dragging = useRef(false);

  const isHorizontal = direction === 'horizontal';

  const clamp = useCallback(
    (size: number) => {
      const el = containerRef.current;
      if (!el) {
        return Math.min(maxFirstSize, Math.max(minFirstSize, size));
      }
      const total = isHorizontal ? el.offsetWidth : el.offsetHeight;
      const separator = 8;
      const maxFromContainer = total - minFirstSize - separator;
      const max = Math.min(maxFirstSize, Math.max(minFirstSize, maxFromContainer));
      return Math.min(max, Math.max(minFirstSize, size));
    },
    [isHorizontal, maxFirstSize, minFirstSize],
  );

  useLayoutEffect(() => {
    setFirstSize((s) => clamp(s));
  }, [clamp]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setFirstSize((s) => clamp(s));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [clamp]);

  useEffect(() => {
    if (!storageKey) return;
    localStorage.setItem(storageKey, String(Math.round(firstSize)));
  }, [firstSize, storageKey]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const next = isHorizontal
        ? e.clientX - rect.left
        : e.clientY - rect.top;
      setFirstSize(clamp(next));
    };

    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [clamp, isHorizontal]);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const firstStyle = isHorizontal
    ? {
        width: firstSize,
        height: '100%',
        minWidth: minFirstSize,
        maxWidth: maxFirstSize,
      }
    : {
        height: firstSize,
        width: '100%',
        minHeight: minFirstSize,
        maxHeight: maxFirstSize,
      };

  return (
    <Box
      ref={containerRef}
      sx={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          ...firstStyle,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {first}
      </Box>

      <Box
        role="separator"
        aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
        aria-label={isHorizontal ? 'Resize panels' : 'Resize Segments and Database'}
        onMouseDown={startDrag}
        sx={{
          flexShrink: 0,
          zIndex: 2,
          touchAction: 'none',
          bgcolor: 'background.paper',
          ...(isHorizontal
            ? {
                width: 8,
                cursor: 'col-resize',
                borderRight: 1,
                borderLeft: 1,
                borderColor: 'divider',
                '&:hover': { bgcolor: 'action.hover' },
                '&:active': { bgcolor: 'action.selected' },
              }
            : {
                height: 10,
                width: '100%',
                cursor: 'row-resize',
                borderTop: 1,
                borderBottom: 1,
                borderColor: 'divider',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                '&:hover': { bgcolor: 'action.hover' },
                '&:active': { bgcolor: 'action.selected' },
                '&::before': {
                  content: '""',
                  display: 'block',
                  width: 48,
                  height: 4,
                  borderRadius: 2,
                  bgcolor: 'action.disabled',
                },
              }),
        }}
      />

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {second}
      </Box>
    </Box>
  );
}
