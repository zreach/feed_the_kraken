// 盘面几何：所有皮肤共享同一套布局，保证不同皮肤格子对齐一致。

import type { GameMap } from '@ftk/engine';

// 交错六边形几何：相邻行（整数行↔交错行）垂直间距 = 0.75*六边形高度
// 格子尺寸按地图列数自适应：列少的地图（短航程）格子更大，铺满容器
export function buildLayout(map: GameMap) {
  const hexes = Object.values(map.hexes);
  const vps = Object.values(map.victoryPoints ?? {});
  const rows = [...new Set([...hexes.map((h) => h.row), ...vps.map((v) => v.row)])].sort((a, b) => a - b);
  const cols = [...new Set([...hexes.map((h) => h.col), ...vps.map((v) => v.col)])].sort((a, b) => a - b);
  const minRow = rows[0];
  const maxRow = rows[rows.length - 1];
  const minCol = cols[0];
  const maxCol = cols[cols.length - 1];
  const colSpan = maxCol - minCol + 1;
  const COL_W = Math.min(150, Math.max(88, 880 / colSpan)); // 同行相邻列间距
  const RW = COL_W * 0.48; // 六边形半宽
  const RH = COL_W * 0.55; // 六边形半高
  const ROW_H = RH * 1.5; // 行间距
  const width = (maxCol - minCol) * COL_W + COL_W * 0.9;
  const height = (maxRow - minRow) * ROW_H + RH * 2.6;
  const pos = (row: number, col: number) => ({
    cx: (col - minCol) * COL_W + COL_W * 0.75,
    cy: (maxRow - row) * ROW_H + RH * 1.4,
  });
  return { pos, width, height, RW, RH };
}

// 尖顶六边形顶点串
export function hexPoints(cx: number, cy: number, rw: number, rh: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + rw * Math.cos(a)).toFixed(1)},${(cy + rh * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}
