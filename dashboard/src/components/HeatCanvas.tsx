import { useEffect, useMemo, useRef } from "react";
import { computeDensity, densityToRgba, type HeatPoint } from "../lib/heatmap";

/**
 * Canvas heat layer covering width × height CSS px. Rendered at grid resolution (one pixel per
 * cell) and stretched by CSS, which gives a smooth bilinear upscale for free.
 */
export function HeatCanvas({
  points,
  width,
  height,
  radius = 40,
  cell,
  opacity = 0.8,
  className,
  style,
}: {
  points: readonly HeatPoint[];
  width: number;
  height: number;
  radius?: number;
  cell?: number;
  opacity?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Keep the grid under ~1.5M cells for very tall pages.
  const cellSize = cell ?? Math.max(3, Math.ceil(Math.sqrt((width * height) / 1_500_000)));
  const grid = useMemo(() => computeDensity(points, { width, height, radius, cell: cellSize }), [points, width, height, radius, cellSize]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = grid.cols;
    c.height = grid.rows;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const img = new ImageData(densityToRgba(grid), grid.cols, grid.rows);
    ctx.putImageData(img, 0, 0);
  }, [grid]);

  return (
    <canvas
      ref={ref}
      className={className}
      aria-hidden="true"
      style={{ position: "absolute", left: 0, top: 0, width, height, opacity, pointerEvents: "none", ...style }}
    />
  );
}
