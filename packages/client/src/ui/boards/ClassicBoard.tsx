// 经典盘面皮肤：原 HexMap 的视觉原样迁移（深海蓝 + emoji 图标），默认皮肤。
// 视觉元素硬编码于组件内；新皮肤请另建组件并在 registry 注册，勿改动本文件样式。

import React from 'react';
import type { BoardProps } from './types';
import { buildLayout, hexPoints } from './geometry';
import { ACTION_ICON } from './icons';

// 方向箭头：从格心指向出口方向的小三角（颜色=导航牌颜色）
function Arrow({
  cx,
  cy,
  dir,
  color,
  victory,
  rw,
  rh,
}: {
  cx: number;
  cy: number;
  dir: 'north' | 'west' | 'east';
  color: string;
  victory?: boolean;
  rw: number;
  rh: number;
}) {
  const dx = dir === 'west' ? -rw + 12 : dir === 'east' ? rw - 12 : 0;
  const dy = dir === 'north' ? -rh + 13 : -rh / 2 + 4;
  const rot = dir === 'north' ? 0 : dir === 'west' ? -55 : 55;
  const size = Math.max(7, rw * 0.18);
  return (
    <g transform={`translate(${cx + dx},${cy + dy}) rotate(${rot})`}>
      <polygon
        points={`0,${-size} ${size * 0.9},${size * 0.8} ${-size * 0.9},${size * 0.8}`}
        fill={color}
        stroke="#fff"
        strokeWidth={victory ? 2 : 1.4}
        opacity={victory ? 1 : 0.85}
      />
      {victory && (
        <text x={0} y={-size - 4} textAnchor="middle" fontSize={size * 1.05} fill={color} stroke="#0d2b3e" strokeWidth={0.6}>
          胜
        </text>
      )}
    </g>
  );
}

const ClassicBoard: React.FC<BoardProps> = ({ view, map }) => {
  const { pos, width, height, RW, RH } = buildLayout(map);
  const rw = RW * 0.9;
  const rh = RH * 0.9;
  const moved = view.prevShipHex !== view.shipHex;
  // 防御：船位/上次船位在地图数据中不存在时不渲染标记（旧存档或数据版本差异）；
  // victory_* 船位（进线终点）按「出发格>方向」从地图 victoryPoints 取紧邻落点。
  const locate = (id: string, prevId?: string) => {
    const h = map.hexes[id];
    if (h) return pos(h.row, h.col);
    const prevHex = prevId ? map.hexes[prevId] : undefined;
    const dir = prevHex ? (['north', 'west', 'east'] as const).find((d) => prevHex.exits[d] === id) : undefined;
    const vp = prevHex && dir ? map.victoryPoints?.[`${prevId}>${dir}`] : undefined;
    return vp ? pos(vp.row, vp.col) : null;
  };
  const from = moved ? locate(view.prevShipHex) : null;
  const to = moved ? locate(view.shipHex, view.prevShipHex) : locate(view.shipHex);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="hexmap"
      style={{ maxWidth: width * 1.35, maxHeight: '66vh', aspectRatio: `${width} / ${height}` }}
      role="img"
      aria-label="航海地图"
    >
      <rect x={0} y={0} width={width} height={height} fill="#0d2b3e" rx={10} />
      <text x={8} y={16} fill="#e05555" fontSize={12}>
        ↖ 绯红湾（海盗）
      </text>
      <text x={width - 118} y={16} fill="#4db8ff" fontSize={12}>
        蓝湾（水手）↗
      </text>
      <text x={width / 2 - 56} y={14} fill="#ffd34d" fontSize={12}>
        ▲ 海妖之域（邪教）
      </text>
      {Object.values(map.hexes).map((h) => {
        const { cx, cy } = pos(h.row, h.col);
        const isShip = view.shipHex === h.id;
        const isPrev = moved && view.prevShipHex === h.id;
        const fill = h.supply ? '#3f6f8f' : h.row % 1 === 0 ? '#1e4a63' : '#1d4560';
        return (
          <g key={h.id}>
            <polygon
              points={hexPoints(cx, cy, rw, rh)}
              fill={fill}
              stroke={isShip ? '#ffd34d' : isPrev ? '#8fd3ff' : '#4a7d99'}
              strokeWidth={isShip ? 3 : isPrev ? 2 : 1.2}
            />
            {h.action && (
              <text x={cx} y={cy + rh * 0.16} textAnchor="middle" fontSize={rw * 0.44}>
                {ACTION_ICON[h.action] ?? '?'}
              </text>
            )}
            {h.id === map.startHexId && !h.action && (
              <text x={cx} y={cy + 5} textAnchor="middle" fontSize={12} fill="#9fc3d6">
                起点
              </text>
            )}
            {(['north', 'west', 'east'] as const).map((dir) => {
              const e = h.exits[dir];
              const color = dir === 'north' ? '#ffd34d' : dir === 'west' ? '#e05555' : '#4db8ff';
              const isVictory = e.startsWith('victory_');
              return <Arrow key={dir} cx={cx} cy={cy} dir={dir} color={color} victory={isVictory} rw={rw} rh={rh} />;
            })}
          </g>
        );
      })}
      {moved && from && to && (
        <line x1={from.cx} y1={from.cy} x2={to.cx} y2={to.cy} stroke="#ffd34d" strokeWidth={3.5} strokeDasharray="7 5" opacity={0.9} />
      )}
      {to && (
        <text x={to.cx} y={to.cy + 7} textAnchor="middle" fontSize={22}>
          ⛵
        </text>
      )}
      <text x={8} y={height - 8} fill="#5f8fa8" fontSize={11}>
        🔍舱搜 🐙献祭 🪢鞭刑 🗡️割舌 · 箭头颜色=导航牌颜色（黄北/红西/蓝东）· 金色虚线为上次航行 · 「胜」=驶入胜利区
      </text>
    </svg>
  );
};

export default ClassicBoard;
