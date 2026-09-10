import { GameMap, MapHex } from '../types';

// ============================================================
// 长航程地图（Long Journey, 7+ 人）
// 拓扑来源：社区逆向数据（github.com/ahmedbasamadz/FeedTheKraken mapLong.js），
// 已用官方规则书地图照片粗核图标分布（4舱搜/2鞭刑/1割舌/3献祭 完全一致）。
// 出口表尚未逐格与实体板核验 —— dataStatus: 'unverified'，见 docs/RULES_NOTES.md §10。
// 坐标系：row 1(南) → 7(北)；col 西负东正。
// ============================================================

type HexInit = {
  id: string;
  row: number; // 1..7 南→北（离散行，含 0.5 行记为 row+0.5）
  col: number;
  n?: string;
  w?: string;
  e?: string;
  action?: MapHex['action'];
};

const V_P = 'victory_pirate';
const V_S = 'victory_sailor';
const V_C = 'victory_cult';

// 出口表（north/west/east），来自社区 EXIT_TABLE，编号→hexId
const EXITS: Record<number, { n: string; w: string; e: string }> = {
  1: { n: '4', w: '2', e: '3' },
  2: { n: '5', w: '5', e: '4' },
  3: { n: '6', w: '4', e: '6' },
  4: { n: '8', w: '5', e: '6' },
  5: { n: '10', w: '7', e: '8' },
  6: { n: '11', w: '8', e: '9' },
  7: { n: '12', w: '12', e: '10' },
  8: { n: '10', w: '10', e: '11' },
  9: { n: '14', w: '11', e: '14' },
  10: { n: '16', w: '12', e: '13' },
  11: { n: '17', w: '13', e: '14' },
  12: { n: '19', w: '15', e: '16' },
  13: { n: '20', w: '16', e: '17' },
  14: { n: '21', w: '17', e: '18' },
  15: { n: '19', w: '22', e: '19' },
  16: { n: '23', w: '19', e: '20' },
  17: { n: '24', w: '20', e: '21' },
  18: { n: '21', w: '21', e: '25' },
  19: { n: '23', w: '26', e: '23' },
  20: { n: '27', w: '23', e: '24' },
  21: { n: '24', w: '24', e: '28' },
  22: { n: V_P, w: V_P, e: '26' },
  23: { n: '29', w: '26', e: '27' },
  24: { n: '30', w: '27', e: '28' },
  25: { n: V_S, w: '28', e: V_S },
  26: { n: V_P, w: V_P, e: '29' },
  27: { n: '31', w: '29', e: '30' },
  28: { n: V_S, w: '30', e: V_S },
  29: { n: V_P, w: V_P, e: '31' },
  30: { n: V_S, w: '31', e: V_S },
  31: { n: V_C, w: V_C, e: V_C },
};

// {num, col, row}
const NODES: { num: number; col: number; row: number }[] = [
  { num: 1, col: 0, row: 1 },
  { num: 2, col: -1, row: 1.5 },
  { num: 3, col: 1, row: 1.5 },
  { num: 4, col: 0, row: 2 },
  { num: 5, col: -1, row: 2.5 },
  { num: 6, col: 1, row: 2.5 },
  { num: 7, col: -2, row: 3 },
  { num: 8, col: 0, row: 3 },
  { num: 9, col: 2, row: 3 },
  { num: 10, col: -1, row: 3.5 },
  { num: 11, col: 1, row: 3.5 },
  { num: 12, col: -2, row: 4 },
  { num: 13, col: 0, row: 4 },
  { num: 14, col: 2, row: 4 },
  { num: 15, col: -3, row: 4.5 },
  { num: 16, col: -1, row: 4.5 },
  { num: 17, col: 1, row: 4.5 },
  { num: 18, col: 3, row: 4.5 },
  { num: 19, col: -2, row: 5 },
  { num: 20, col: 0, row: 5 },
  { num: 21, col: 2, row: 5 },
  { num: 22, col: -3, row: 5.5 },
  { num: 23, col: -1, row: 5.5 },
  { num: 24, col: 1, row: 5.5 },
  { num: 25, col: 3, row: 5.5 },
  { num: 26, col: -2, row: 6 },
  { num: 27, col: 0, row: 6 },
  { num: 28, col: 2, row: 6 },
  { num: 29, col: -1, row: 6.5 },
  { num: 30, col: 1, row: 6.5 },
  { num: 31, col: 0, row: 7 },
];

// 行动格分布（与官方照片核对一致）
const ACTIONS: Record<number, MapHex['action']> = {
  5: 'cabinSearch',
  6: 'cabinSearch',
  7: 'cabinSearch',
  8: 'cabinSearch',
  13: 'offWithTongue',
  16: 'flogging',
  17: 'flogging',
  23: 'feedTheKraken',
  24: 'feedTheKraken',
  27: 'feedTheKraken',
};

const SUPPLY_LINE_ROW = 4; // row >= 4 视为补给线以北（依据地图照片虚线位置，待最终核验）

// 每个方向的紧邻步长（row, col）：长图东西向走半行一整列，北向走一整行
const L_STEP: Record<'north' | 'west' | 'east', [number, number]> = {
  north: [1, 0],
  west: [0.5, -1],
  east: [0.5, 1],
};

function buildLongMap(): GameMap {
  const hexes: Record<string, MapHex> = {};
  for (const node of NODES) {
    const ex = EXITS[node.num];
    hexes[`h${node.num}`] = {
      id: `h${node.num}`,
      row: node.row,
      col: node.col,
      exits: {
        north: ex.n.startsWith('victory_') ? ex.n : `h${ex.n}`,
        west: ex.w.startsWith('victory_') ? ex.w : `h${ex.w}`,
        east: ex.e.startsWith('victory_') ? ex.e : `h${ex.e}`,
      },
      action: ACTIONS[node.num],
      supply: node.row >= SUPPLY_LINE_ROW,
    };
  }
  // 进线落点：victory_* 出口的紧邻格位置，键为 `格子>方向`
  const victoryPoints: Record<string, { row: number; col: number }> = {};
  for (const h of Object.values(hexes)) {
    for (const dir of ['north', 'west', 'east'] as const) {
      if (h.exits[dir].startsWith('victory_')) {
        const [dr, dc] = L_STEP[dir];
        victoryPoints[`${h.id}>${dir}`] = { row: h.row + dr, col: h.col + dc };
      }
    }
  }
  return {
    id: 'long',
    nameZh: '长航程（7-11人）',
    hexes,
    startHexId: 'h1',
    dataStatus: 'unverified',
    victoryPoints,
  };
}


// ============================================================
// 快航程地图（Quick Journey, 5-7 人）
// 依据用户提供的官方地图照片（pics/short.jpeg）逐格转录：
// 11 行晶格、22 格；行动格 3×舱搜 + 2×献祭（与规则书组件数一致）；
// 无补给线、无鞭刑/割舌。船从南部起点出发。
// 坐标：row 南→北；col：整数行 -1/0/+1，交错行 ±0.5。
//
// 2026-09 修正（用户实测反馈 + 照片局部核验，见 docs/RULES_NOTES.md §10）：
// - 原转录从起点连打 3 张同色牌即直抵蓝湾/绯红湾，与实体板不符。
//   实体板（用户口述锚定）：起点第 3 张蓝/红牌箭头均向上，蓝、红线各 5 张
//   同色牌进胜利区（黄线原为 5 张，三方对称）。据此仅改 4 个出口：
//   蓝线 q1→q2b→q3b→q5c→q7c→蓝湾（5蓝，q3b.e/q5c.e 改判，q7c.e 原转录即蓝湾）；
//   红线 q1→q2→q3→q5→q7→绯红湾（5红，q3.w/q5.w 改判，q7.w 原转录即绯红湾）。
// - 2026-09-10 补充实测：两蓝一黄后船不应"跳到中间岛"——东侧纵列的黄牌箭头
//   也应紧贴本列向上，故 q3b.n 由 q5b（中间列）改判为 q5c（东侧纵列正上方）。
//   东侧纵列实际为一条竖直通道：q2b/q3b/q5c/q7c 上下相邻，蓝黄牌均可沿列直上。
// - 2026-09-10 补充实测：蓝后红 / 红后蓝 不应落在两红/两蓝的落点（原转录
//   q2b.w 与 q2.e 均误指 q3）。改判为汇合到中间列的 q3c（修道院格）：
//   q2b.w→q3c、q2.e→q3c。q2b.n→q4b、q2.n→q4（舱搜格）暂保留待核。
// - 2026-09-10 补充实测：q9 为三线交汇格——三支箭头分别直插三条线：
//   东=蓝湾、西=绯红湾、北=海妖之域，一步判胜（蓝线涉及 3 格：q7c/q8b/q9，
//   红线 3 格：q7/q8/q9，黄线 1 格：q9）。原转录 q9 指向 q10/q10b/q11 的出口作废，
//   这三个格子现不可达，仅保留数据不渲染航线（待实体板最终确认后清理）。
// - 已知存疑待核：q2 的西/东出口同指 q3（与长图多出口同靶先例一致，暂保留）、
//   q7.n 直指绯红湾。整体拓扑仍待与实体板逐格复核。
// ============================================================

type QHexInit = { id: string; row: number; col: number; n?: string; w?: string; e?: string; action?: MapHex['action'] };

const Q_V_P = 'victory_pirate';
const Q_V_S = 'victory_sailor';
const Q_V_C = 'victory_cult';

const Q_NODES: QHexInit[] = [
  // row 1（最南）
  { id: 'q1',  row: 1,   col: 0,  n: 'q3c', w: 'q2',  e: 'q2b' },
  // row 1.5
  { id: 'q2',  row: 1.5, col: -0.5, n: 'q4', w: 'q3', e: 'q3c' },
  { id: 'q2b', row: 1.5, col: 0.5,  n: 'q4b', w: 'q3c', e: 'q3b' },
  // row 2
  { id: 'q3',  row: 2,   col: -1,  n: 'q5',  w: 'q5', e: 'q4' },
  { id: 'q3b', row: 2,   col: 1,   n: 'q5c', w: 'q4b', e: 'q5c' },
  { id: 'q3c', row: 2,   col: 0,   n: 'q6',  w: 'q4',  e: 'q4b' },
  // row 2.5（舱搜）
  { id: 'q4',  row: 2.5, col: -0.5, n: 'q6', w: 'q5', e: 'q5b', action: 'cabinSearch' },
  { id: 'q4b', row: 2.5, col: 0.5,  n: 'q6b', w: 'q5b', e: 'q5c', action: 'cabinSearch' },
  // row 3（舱搜 / 城堡 / 右）
  { id: 'q5',  row: 3,   col: -1,  n: 'q7',  w: 'q7', e: 'q6', action: 'cabinSearch' },
  { id: 'q5b', row: 3,   col: 0,   n: 'q7b', w: 'q6', e: 'q6b' },
  { id: 'q5c', row: 3,   col: 1,   n: 'q7c', w: 'q6b', e: 'q7c' },
  // row 3.5
  { id: 'q6',  row: 3.5, col: -0.5, n: 'q8', w: 'q7', e: 'q7b' },
  { id: 'q6b', row: 3.5, col: 0.5,  n: 'q8b', w: 'q7b', e: 'q7c' },
  // row 4
  { id: 'q7',  row: 4,   col: -1,  n: Q_V_P, w: Q_V_P, e: 'q8' },
  { id: 'q7b', row: 4,   col: 0,   n: 'q9',  w: 'q8', e: 'q8b' },
  { id: 'q7c', row: 4,   col: 1,   n: Q_V_S, w: 'q8b', e: Q_V_S },
  // row 4.5（献祭海妖）
  { id: 'q8',  row: 4.5, col: -0.5, n: 'q10', w: Q_V_P, e: 'q9', action: 'feedTheKraken' },
  { id: 'q8b', row: 4.5, col: 0.5,  n: 'q10b', w: 'q9', e: Q_V_S, action: 'feedTheKraken' },
  // row 5
  { id: 'q9',  row: 5,   col: 0,   n: Q_V_C, w: Q_V_P, e: Q_V_S },
  // row 5.5
  { id: 'q10',  row: 5.5, col: -0.5, n: Q_V_C, w: Q_V_C, e: 'q11' },
  { id: 'q10b', row: 5.5, col: 0.5,  n: Q_V_C, w: 'q11', e: Q_V_S },
  // row 6（北：邪教胜利）
  { id: 'q11', row: 6,   col: 0,   n: Q_V_C, w: Q_V_C, e: Q_V_C },
];

// 每个方向的紧邻步长（row, col）：快图东西向走半行半列，北向走一整行
const Q_STEP: Record<'north' | 'west' | 'east', [number, number]> = {
  north: [1, 0],
  west: [0.5, -0.5],
  east: [0.5, 0.5],
};

function buildQuickMap(): GameMap {
  const hexes: Record<string, MapHex> = {};
  for (const nd of Q_NODES) {
    hexes[nd.id] = {
      id: nd.id,
      row: nd.row,
      col: nd.col,
      exits: {
        north: nd.n ?? Q_V_C,
        west: nd.w ?? Q_V_P,
        east: nd.e ?? Q_V_S,
      },
      action: nd.action,
    };
  }
  // 进线落点：victory_* 出口的紧邻格位置，键为 `格子>方向`
  const victoryPoints: Record<string, { row: number; col: number }> = {};
  for (const h of Object.values(hexes)) {
    for (const dir of ['north', 'west', 'east'] as const) {
      if (h.exits[dir].startsWith('victory_')) {
        const [dr, dc] = Q_STEP[dir];
        victoryPoints[`${h.id}>${dir}`] = { row: h.row + dr, col: h.col + dc };
      }
    }
  }
  return {
    id: 'quick',
    nameZh: '短航程（5-7人）',
    hexes,
    startHexId: 'q1',
    dataStatus: 'unverified',
    victoryPoints,
  };
}


let _longMap: GameMap | null = null;
let _quickMap: GameMap | null = null;
export function getLongMap(): GameMap {
  if (!_longMap) _longMap = buildLongMap();
  return _longMap;
}
export function getQuickMap(): GameMap {
  if (!_quickMap) _quickMap = buildQuickMap();
  return _quickMap;
}

export function getMap(id: 'quick' | 'long'): GameMap {
  if (id === 'quick') return getQuickMap();
  return getLongMap();
}
