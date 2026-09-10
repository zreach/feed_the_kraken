// 官方航海图皮肤：直接以官方盘面图（pics/ 的正视图扫描）为底，
// 只叠加动态标记——当前船位高亮、船位标记、上次航行轨迹。
// 海格、出口箭头、行动图标、图例等静态元素均已在图中印刷，无需叠加。
//
// 格子像素中心标定（viewBox 1200×1200）：
// - 长航程由线性模型拟合标志物验证：x = 600 + 145*col，y = 105 + (6-y)*157.5（col/y 为棋盘坐标）
// - 快航程为逐格目测标定（误差约 ±30px，格宽约 135px）

import React from 'react';
import type { BoardProps } from './types';
import { hexPoints } from './geometry';

const IMG: Record<'quick' | 'long', string> = {
  quick: '/official/short.jpeg',
  long: '/official/long.jpeg',
};

const QUICK_CENTERS: Record<string, [number, number]> = {
  q1: [603, 970],
  q2: [463, 909],
  q2b: [738, 909],
  q3: [340, 825],
  q3b: [880, 825],
  q3c: [603, 836],
  q4: [460, 743],
  q4b: [748, 755],
  q5: [327, 660],
  q5b: [600, 660],
  q5c: [880, 660],
  q6: [465, 573],
  q6b: [730, 590],
  q7: [327, 493],
  q7b: [600, 498],
  q7c: [860, 490],
  q8: [465, 430],
  q8b: [735, 430],
  q9: [597, 333],
  q10: [465, 280],
  q10b: [735, 333],
  q11: [600, 170],
};

const LONG_CENTERS: Record<string, [number, number]> = {
  h1: [600, 1050],
  h2: [455, 971],
  h3: [745, 971],
  h4: [600, 892],
  h5: [455, 814],
  h6: [745, 814],
  h7: [310, 735],
  h8: [600, 785],
  h9: [890, 735],
  h10: [455, 656],
  h11: [745, 656],
  h12: [310, 578],
  h13: [600, 578],
  h14: [890, 578],
  h15: [165, 499],
  h16: [455, 499],
  h17: [745, 499],
  h18: [1035, 499],
  h19: [310, 420],
  h20: [600, 420],
  h21: [890, 420],
  h22: [165, 341],
  h23: [455, 341],
  h24: [745, 341],
  h25: [1035, 341],
  h26: [310, 263],
  h27: [600, 263],
  h28: [890, 263],
  h29: [455, 184],
  h30: [745, 184],
  h31: [600, 105],
};

// 进线时船的落点 = 出发格中心 + 该方向的紧邻步长（像素，与标定线性模型一致）
const VICTORY_DELTA: Record<'quick' | 'long', Record<'north' | 'west' | 'east', [number, number]>> = {
  quick: { east: [135, -61], west: [-135, -61], north: [0, -170] },
  long: { east: [145, -79], west: [-145, -79], north: [0, -158] },
};

const HEX_SIZE: Record<'quick' | 'long', { rw: number; rh: number }> = {
  quick: { rw: 64, rh: 66 },
  long: { rw: 72, rh: 80 },
};

// 帆船剪影（墨色船身 + 白帆 + 金晕，官方图上足够醒目）
function Ship({ x, y, s }: { x: number; y: number; s: number }) {
  const u = (s * 0.9) / 26;
  return (
    <g transform={`translate(${x},${y}) scale(${u})`}>
      <circle cx={0} cy={-2} r={19} fill="rgba(255,255,255,0.4)" />
      <circle cx={0} cy={-2} r={15} fill="rgba(255,211,77,0.35)" />
      <path d="M -12 5 Q 0 10 12 5 L 8.5 -1 L -8.5 -1 Z" fill="#2b1f14" stroke="#ffd34d" strokeWidth={1.4} />
      <path d="M 0.5 -2 L 0.5 -14 L 8 -2 Z" fill="#faf4e2" stroke="#2b1f14" strokeWidth={1} />
      <path d="M -0.5 -2 L -0.5 -11.5 L -6.5 -2 Z" fill="#e8d9b0" stroke="#2b1f14" strokeWidth={0.9} />
      <line x1={0.5} y1={-15} x2={0.5} y2={-2} stroke="#2b1f14" strokeWidth={1.1} />
      <path d="M 0.5 -15 L 5.5 -13 L 0.5 -11.5 Z" fill="#c0392b" />
    </g>
  );
}

const OfficialBoard: React.FC<BoardProps> = ({ view, map }) => {
  const mapId = view.mapId;
  const centers = mapId === 'quick' ? QUICK_CENTERS : LONG_CENTERS;
  const { rw, rh } = HEX_SIZE[mapId];
  const moved = view.prevShipHex !== view.shipHex;
  const from = moved ? centers[view.prevShipHex] : undefined;
  // 进线落点（victory_*）：从出发格沿获胜牌方向走一格的紧邻位置
  let to = centers[view.shipHex];
  if (!to && moved && from) {
    const prevHex = map.hexes[view.prevShipHex];
    const dir = prevHex ? (['north', 'west', 'east'] as const).find((d) => prevHex.exits[d] === view.shipHex) : undefined;
    const delta = dir ? VICTORY_DELTA[mapId][dir] : undefined;
    if (delta) to = [from[0] + delta[0], from[1] + delta[1]];
  }

  return (
    <svg
      viewBox="0 0 1200 1200"
      className="hexmap official"
      style={{ maxWidth: '100%', maxHeight: '66vh', aspectRatio: '1 / 1' }}
      role="img"
      aria-label="官方航海图"
    >
      <image href={IMG[mapId]} x={0} y={0} width={1200} height={1200} preserveAspectRatio="xMidYMid meet" />

      {/* 上次航行轨迹（深色衬底 + 金色虚线，在深浅海面上都可见） */}
      {moved && from && to && (
        <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke="rgba(0,0,0,0.5)" strokeWidth={7} strokeDasharray="10 8" />
      )}
      {moved && from && to && (
        <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke="#ffd34d" strokeWidth={4} strokeDasharray="10 8" />
      )}

      {/* 上次船位：金色虚线圈 */}
      {moved && from && (
        <polygon points={hexPoints(from[0], from[1], rw, rh)} fill="none" stroke="rgba(255,211,77,0.85)" strokeWidth={2.2} strokeDasharray="6 5" />
      )}

      {/* 当前船位格：金色高亮 */}
      {to && <polygon points={hexPoints(to[0], to[1], rw, rh)} fill="rgba(255,211,77,0.16)" stroke="#ffd34d" strokeWidth={4.5} />}
      {to && <polygon points={hexPoints(to[0], to[1], rw * 0.86, rh * 0.86)} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1.4} />}

      {/* 船位标记 */}
      {to && <Ship x={to[0]} y={to[1]} s={rw} />}
    </svg>
  );
};

export default OfficialBoard;
