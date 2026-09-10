// ============ 基础类型 ============

export type Faction = 'sailor' | 'pirate' | 'cultLeader' | 'cultist';

export type FactionGroup = 'sailor' | 'pirate' | 'cult'; // cultLeader 与 cultist 同组

export type Position = 'captain' | 'lieutenant' | 'navigator';

export type Direction = 'north' | 'east' | 'west';

export type MapActionKind =
  | 'cabinSearch'
  | 'flogging'
  | 'offWithTongue'
  | 'feedTheKraken';

export type NavCardType =
  | 'cultUprising'
  | 'drunk'
  | 'disarmed'
  | 'mermaid'
  | 'telescope'
  | 'armed';

export interface NavCardDef {
  id: string;
  type: NavCardType;
  direction: Direction; // 黄=北 蓝=东 红=西
}

export type CharacterTiming =
  | 'anytime'
  | 'beforeAppointment' // 任命前
  | 'afterAppointment' // 任命后
  | 'beforeDraw' // 抽牌前
  | 'afterReveal' // 枪揭示后
  | 'yellowRound' // 黄牌回合
  | 'gunCost'; // 弃枪启动（军械师，任意时机+代价）

export interface CharacterDef {
  id: string;
  nameZh: string;
  nameEn: string;
  textZh: string;
  timing: CharacterTiming;
}

// ============ 地图 ============

export type HexExit = string; // hexId 或 'victory_pirate' | 'victory_sailor' | 'victory_cult'

export interface MapHex {
  id: string;
  row: number;
  col: number;
  exits: { north: HexExit; west: HexExit; east: HexExit };
  action?: MapActionKind;
  supply?: boolean; // 位于补给线以北（长航程）
}

export type VictoryKind = 'sailor' | 'pirate' | 'cult';

export interface GameMap {
  id: 'quick' | 'long';
  nameZh: string;
  hexes: Record<string, MapHex>;
  startHexId: string;
  dataStatus: 'verified' | 'unverified'; // 数据核验状态
  // 胜利区内的船终点渲染坐标（row/col 同格子坐标系）：键为 `格子>方向`
  // （如 "q9>east"），值为该方向上紧邻的线内落点。船进线时 shipHex 置为
  // victory_*，客户端据此把船画在紧邻格再宣布终局；旧存档地图无此字段时
  // 客户端回退为不渲染船位。
  victoryPoints?: Record<string, { row: number; col: number }>;
}

// ============ 房间/玩家 ============

export type RoomPhase = 'lobby' | 'playing' | 'ended' | 'archived';

export interface RoomConfig {
  playerCount: number; // 开局所需人数（5-11）
  mapId: 'quick' | 'long' | 'auto'; // auto: 快航程数据核验前统一长航程
  excludeSuggestedCharacters: boolean; // 5-6人排除讨债人/吟游诗人/导师（官方建议）
  roomPassword: string; // 空串表示无口令（引擎内不使用，口令哈希存服务端包装层）
}

export interface PlayerSession {
  seatId: number;
  token: string; // 恢复凭据，绝不进入公开视图
  name: string;
  connected: boolean;
  lastSeen: number;
}

// ============ 游戏状态 ============

export interface PlayerState {
  seatId: number;
  name: string;
  faction: Faction | null;
  characterId: string | null;
  characterRevealed: boolean; // 亮出后为 true；被 Mentor 翻回为 false；翻面可再启动
  guns: number;
  resumeCount: number; // 简历牌数（面前亮出的导航牌数）
  resumes: string[]; // 简历牌明细（公开信息：作为船长时打出的导航牌）
  offDuty: boolean;
  noTongue: boolean;
  eliminated: boolean;
  eliminationReason: 'overboard' | 'kraken' | null;
  cabinSearched: boolean; // 不可被皈依
  flogged: boolean; // 不可被皈依
  notFactions: Faction[]; // "我不是X" 公开信息（鞭刑结果）
}

export interface MutinyState {
  stage: 'none' | 'submitting' | 'revealed';
  submissions: Record<number, number | null>; // seatId -> 提交枪数（null 未交）
  submittedOrder: number[];
  threshold: number;
  revealedTotal: number;
  // 修正器
  troublemakerTarget: number | null;
  peacemakerTarget: number | null;
  instigatorTarget: number | null;
  instigatorAnswerPending: boolean;
  equalizerActive: boolean;
  rabbleRouserActive: boolean;
  // 效果
  forcedMin: number; // 煽动者强制的最少枪数（按 seat 记录见 forcedMinBySeat）
  forcedMinBySeat: Record<number, number>;
  excludedFromMutiny: number[]; // Minstrel 选中的座位
  maxRevealPerPlayer: number | null; // Equalizer: 1
  succeeded: boolean | null;
  tieChain: number[]; // 平局者座位
  tiePicker: number | null; // 当前指定者
}

export type NavStage =
  | 'none'
  | 'captainDiscard'
  | 'lieutenantDiscard'
  | 'navigatorChoose'
  | 'resolveCard'
  | 'done';

export interface NavigationState {
  stage: NavStage;
  emergency: boolean; // 紧急航海（拒令后）
  captainCards: string[]; // 船长手中2-3张
  lieutenantCards: string[];
  captainDiscarded?: string[];
  lieutenantDiscarded?: string[];
  archivistSeat?: number | null; // 档案员标记（抽牌后可选重抽）
  smugglerSeat: number | null; // 本轮抽3张者
  logbook: string[]; // 交给领航员的2张
}

export interface PendingChoice {
  id: number;
  kind: PendingKind;
  actorSeat: number; // -1 表示多人窗口
  data: Record<string, unknown>;
  reasonZh: string;
  createdAtEvent: number;
}

export type PendingKind =
  | 'activationWindow' // 多人窗口：通过或启动角色
  | 'appointTeam'
  | 'consultantLieutenant'
  | 'mutinySubmit'
  | 'tiePick'
  | 'chooseCard'
  | 'navigatorChoose'
  | 'captainReveal'
  | 'emergencyNavigator'
  | 'choosePlayer'
  | 'floggingSelfDeclare'
  | 'gunsStash'
  | 'telescopeDecision'
  | 'instigatorAnswer'
  | 'spiritualistPick'
  | 'spiritualistTarget2'
  | 'spiritualistRecipient';

export interface ActivationOption {
  seatId: number;
  characterId: string;
  needsGunCost?: boolean;
}

export interface ActivationWindowState {
  windowKind:
    | 'beforeAppointment'
    | 'afterAppointment'
    | 'beforeDraw'
    | 'afterReveal'
    | 'yellowRound'
    | 'free';
  passedSeats: number[];
  options: ActivationOption[]; // 当前仍可启动的选项
}

export interface CultRitualState {
  deckOrder: string[]; // 预先洗混的仪式牌序列
  revealedCount: number;
  pendingRitual: string | null; // 待执行的仪式牌 id
}

export interface ChatMessage {
  id: number;
  seatId: number; // -1 系统
  name: string;
  text: string;
  ts: number;
}

export interface LogEntry {
  id: number;
  ts: number;
  textZh: string;
  visibility: 'public' | number; // public 或指定 seatId 私密
}

export interface GameResult {
  winner: 'sailor' | 'pirate' | 'cult';
  reasonZh: string;
  factions: Record<number, Faction>;
}

export interface GameState {
  version: number; // 存档版本
  eventSeq: number;
  mapId: 'quick' | 'long';
  map: GameMap;
  shipHex: string; // 船当前位置
  prevShipHex: string; // 上一次移动前的位置（用于航行高亮）
  config: RoomConfig;
  players: PlayerState[];
  playerCount: number;
  seatCount: number; // = playerCount
  round: number;
  // 职位（seatId，-1 为空缺）
  captain: number;
  lieutenant: number;
  navigator: number;
  // 牌堆
  navDeck: string[];
  navDiscard: string[];
  recentDiscards: string[]; // 最近3张弃牌（美人鱼用）
  cultRitual: CultRitualState;
  /** Players converted during play; initial 11-player cultist has no leader knowledge. */
  convertedCultists: number[];
  /** Opening pirate seats. Kept as private memory so an unconverted pirate still trusts a converted former teammate. */
  initialPirateSeats?: number[];
  // 状态机
  stage: string; // 主阶段标识
  pending: PendingChoice[];
  activation: ActivationWindowState | null;
  mutiny: MutinyState;
  navigation: NavigationState;
  pendingMapAction: MapActionKind | null;
  playedCardThisRound: string | null;
  yellowPlayedThisRound: boolean;
  crossedSupplyLine: boolean;
  gunSupply: number; // 供应区剩余枪数
  offDutyCount: number;
  // 角色效果挂账
  gunsmithActive: number[]; // 已亮出军械师的座位
  nextMutinyModifiers: {
    excludedSeats: number[]; // Minstrel
    forcedMinBySeat: Record<number, number>; // Agitator
    equalizer: boolean; // Equalizer
  };
  result: GameResult | null;
  seededRngState: number[]; // RNG 状态（服务端持有，不进玩家视图）
  log: LogEntry[];
}

// ============ 命令（客户端提交的意图） ============

export type Command =
  | { type: 'pass' }
  | { type: 'activateCharacter'; characterId: string }
  | { type: 'appoint'; lieutenant: number; navigator: number }
  | { type: 'appointLieutenant'; seat: number } // Consultant
  | { type: 'submitGuns'; count: number }
  | { type: 'tiePick'; seat: number }
  | { type: 'chooseCard'; cardId: string }
  | { type: 'navigatorAction'; action: 'discard'; cardId: string } | { type: 'navigatorAction'; action: 'jumpShip' }
  | { type: 'revealNavigation' }
  | { type: 'choosePlayer'; seat: number }
  | { type: 'floggingDeclare'; declares: 'sailor' | 'pirate' | 'cult' }
  | { type: 'allocateGuns'; alloc: Record<number, number> }
  | { type: 'telescopeDecision'; discard: boolean }
  | { type: 'instigatorAnswer'; join: boolean }
  | { type: 'chat'; text: string };

// ============ 视图 ============

export interface ViewPlayer {
  seatId: number;
  name: string;
  connected: boolean;
  guns: number | null; // null = 哗变保密期间不可见（哗变外为公开信息）
  resumeCount: number;
  offDuty: boolean;
  noTongue: boolean;
  eliminated: boolean;
  eliminationReason: string | null;
  notFactions: Faction[];
  resumes: string[]; // 简历明细（公开）
  unconvertible: boolean; // 被舱搜/鞭刑过（公开事件，可公开推知不可被皈依）
  characterRevealed: boolean;
  revealedCharacterId: string | null;
  isCaptain: boolean;
  isLieutenant: boolean;
  isNavigator: boolean;
  faction: Faction | null; // 本人、已公开，或依规则互认/记忆的阵营；其余为 null
  characterId: string | null; // 仅本人
  characterRevealedSelf: boolean;
}

export interface ViewPending {
  id: number;
  kind: PendingKind;
  mine: boolean;
  actorSeat: number;
  reasonZh: string;
  data: Record<string, unknown>; // 已过滤
}

export interface PlayerView {
  you: {
    seatId: number;
    name: string;
    faction: Faction | null;
    characterId: string | null;
    characterRevealed: boolean;
    guns: number;
    offDuty: boolean;
    noTongue: boolean;
    eliminated: boolean;
    teammates: number[]; // 海盗开局互识；皈依后本人与邪教主互识
  };
  players: ViewPlayer[];
  mapId: 'quick' | 'long';
  shipHex: string;
  prevShipHex: string;
  usedMapActions: string[];
  round: number;
  stage: string;
  stageZh: string;
  captain: number;
  lieutenant: number;
  navigator: number;
  navDeckCount: number;
  navDiscardCount: number;
  yourHand: string[]; // 航海中你持有的导航牌
  logbookCount: number;
  pending: ViewPending[];
  activationOptions: ActivationOption[];
  activationWindowKind: string | null;
  youPassedWindow: boolean;
  result: GameResult | null;
  notFactionsPublic: Record<number, Faction[]>;
  ritualsRevealed: string[];
  mutinyPublic: {
    stage: string;
    submittedCount: number;
    eligibleCount: number;
    revealedTotal: number | null;
    threshold: number;
    revealedBySeat: Record<number, number> | null;
  };
  waitingFor: string; // 中文描述正在等谁
}
