// ============================================================
// 《险恶疑航》规则引擎 — 服务端权威、确定性状态机
// 所有状态转换在此发生；随机性通过注入的 Rng 完成。
// 规则依据：docs/RULES_NOTES.md（官方规则书 V1.0 + 官方角色卡 PnP）
// ============================================================

import {
  Command,
  Faction,
  GameState,
  MapActionKind,
  PendingChoice,
  PlayerState,
} from './types';
import { CHARACTER_MAP } from './data/characters';
import { NAV_CARD_MAP, NAV_TYPE_ZH, DIRECTION_ZH, mutinyThreshold } from './data/gamedata';
import {
  alivePlayers,
  clockwiseFrom,
  freshMutiny,
  pushLog,
  seatOf,
} from './state';
import { Rng, SeededRng } from './rng';

export class RuleError extends Error {
  code: string;
  constructor(code: string, messageZh: string) {
    super(messageZh);
    this.code = code;
  }
}

let pendingSeq = 1;

// ============ 工具 ============

function rngOf(state: GameState): Rng {
  return SeededRng.fromState(state.seededRngState);
}

function saveRng(state: GameState, rng: Rng) {
  state.seededRngState = (rng as SeededRng).exportState();
}

function pushPending(state: GameState, p: Omit<PendingChoice, 'id' | 'createdAtEvent'>) {
  state.eventSeq += 1;
  state.pending.push({ ...p, id: pendingSeq++, createdAtEvent: state.eventSeq });
}

function topPending(state: GameState): PendingChoice | undefined {
  return state.pending[state.pending.length - 1];
}

function nameOf(state: GameState, seatId: number): string {
  return seatOf(state, seatId).name;
}

export function describePlayer(state: GameState, seatId: number): string {
  const p = seatOf(state, seatId);
  const tags: string[] = [];
  if (state.captain === seatId) tags.push('船长');
  if (state.lieutenant === seatId) tags.push('副手');
  if (state.navigator === seatId) tags.push('领航员');
  if (p.offDuty && state.captain !== seatId) tags.push('停职');
  if (p.eliminated) tags.push('已出局');
  const tagStr = tags.length ? `（${tags.join('/')}）` : '';
  return `${p.name}${tagStr}`;
}

function isConvertible(p: PlayerState): boolean {
  if (p.eliminated) return false;
  if (p.faction === 'cultLeader' || p.faction === 'cultist') return false;
  if (p.cabinSearched || p.flogged) return false;
  return true;
}

function lieutenantValid(state: GameState): boolean {
  return state.lieutenant >= 0 && !seatOf(state, state.lieutenant).eliminated;
}

function navigatorValid(state: GameState): boolean {
  return state.navigator >= 0 && !seatOf(state, state.navigator).eliminated;
}

// 副手/领航员任命资格（停职者不可被任命，除非可用人手不足）
function canAppoint(state: GameState, seatId: number, role: 'lieutenant' | 'navigator'): boolean {
  const p = seatOf(state, seatId);
  if (p.eliminated || p.seatId === state.captain) return false;
  if (role === 'navigator' && p.seatId === state.lieutenant) return false;
  if (role === 'lieutenant' && p.seatId === state.navigator) return false;
  if (p.offDuty) {
    const available = alivePlayers(state).filter(
      (q) =>
        !q.offDuty &&
        q.seatId !== state.captain &&
        (role === 'navigator' ? q.seatId !== state.lieutenant : q.seatId !== state.navigator),
    );
    if (available.filter((q) => q.seatId !== p.seatId).length >= 1) return false;
  }
  return true;
}

// ============ 主入口 ============

export function applyCommand(state: GameState, seatId: number, cmd: Command): void {
  if (state.result) throw new RuleError('GAME_OVER', '对局已结束');
  const player = seatOf(state, seatId);
  if (player.eliminated) {
    throw new RuleError('ELIMINATED', '你已出局，无法执行操作');
  }
  const rng = rngOf(state);
  try {
    handleCommand(state, rng, seatId, cmd);
  } finally {
    saveRng(state, rng);
  }
  advance(state, rng);
}

function badCmd(): RuleError {
  return new RuleError('BAD_COMMAND', '当前状态下不能执行该操作');
}

function handleCommand(state: GameState, rng: Rng, seatId: number, cmd: Command) {
  const pending = topPending(state);
  if (!pending || pending.kind === 'activationWindow') {
    handleWindowCommand(state, rng, seatId, cmd);
    return;
  }
  // 忠诚质询是多人同时秘密提交：同一个 pending 对所有尚未提交的
  // 合资格玩家开放，不能再用 actorSeat 串行点名。
  if (pending.kind === 'mutinySubmit') {
    if (cmd.type !== 'submitGuns') throw badCmd();
    handleMutinySubmit(state, seatId, cmd.count);
    return;
  }
  if (pending.actorSeat !== seatId) {
    throw new RuleError('NOT_YOUR_TURN', `当前等待 ${nameOf(state, pending.actorSeat)} 操作`);
  }
  switch (pending.kind) {
    case 'appointTeam': {
      if (cmd.type !== 'appoint') throw badCmd();
      const navigatorOnly = pending.data.navigatorOnly === true;
      if (navigatorOnly) {
        if (!canAppoint(state, cmd.navigator, 'navigator')) {
          throw new RuleError('BAD_TARGET', '该玩家不能被任命为领航员');
        }
        state.navigator = cmd.navigator;
        state.pending.pop();
        pushLog(state, `船长 ${nameOf(state, seatId)} 任命领航员 ${describePlayer(state, cmd.navigator)}。`);
        beginMutinyPhase(state);
      } else {
        validateAppoint(state, cmd.lieutenant, cmd.navigator);
        state.lieutenant = cmd.lieutenant;
        state.navigator = cmd.navigator;
        state.pending.pop();
        pushLog(
          state,
          `船长 ${nameOf(state, seatId)} 任命航海组：副手 ${describePlayer(state, cmd.lieutenant)}，领航员 ${describePlayer(state, cmd.navigator)}。`,
        );
        beginMutinyPhase(state);
      }
      break;
    }
    case 'consultantLieutenant': {
      if (cmd.type !== 'choosePlayer') throw badCmd();
      if (!canAppoint(state, cmd.seat, 'lieutenant')) {
        throw new RuleError('BAD_TARGET', '该玩家不能被任命为副手');
      }
      state.lieutenant = cmd.seat;
      state.pending.pop();
      state.stage = 'appointConsultant'; // 窗口关闭后再让船长任命领航员
      pushLog(state, `顾问发动：${nameOf(state, cmd.seat)} 被指定为副手。`);
      break;
    }
    case 'tiePick': {
      if (cmd.type !== 'choosePlayer') throw badCmd();
      const chain = state.mutiny.tieChain;
      if (!chain.includes(cmd.seat)) throw new RuleError('BAD_TARGET', '该玩家不在平局者中');
      state.pending.pop();
      pushLog(state, `${nameOf(state, seatId)} 指定 ${nameOf(state, cmd.seat)} 退出船长争夺。`);
      chain.splice(chain.indexOf(cmd.seat), 1);
      if (chain.length === 1) {
        cleanupMutiny(state, true, chain[0], true);
        finishMutiny(state, chain[0]);
      } else {
        pushPending(state, {
          kind: 'tiePick',
          actorSeat: cmd.seat,
          data: { candidates: chain.slice() },
          reasonZh: '请指定一名平局者退出船长争夺',
        });
      }
      break;
    }
    case 'chooseCard':
      handleChooseCard(state, rng, pending, seatId, cmd);
      break;
    case 'navigatorChoose':
      handleNavigatorCommand(state, rng, seatId, cmd);
      break;
    case 'captainReveal':
      if (cmd.type !== 'revealNavigation') throw badCmd();
      if (seatId !== state.captain) throw new RuleError('NOT_YOUR_TURN', '只有船长可以公开并执行最终导航牌');
      state.pending.pop();
      pushLog(state, `船长 ${nameOf(state, seatId)} 打开航海日志，准备公开最终导航牌。`);
      state.stage = 'resolveNavCard';
      break;
    case 'emergencyNavigator': {
      if (cmd.type !== 'choosePlayer') throw badCmd();
      const target = seatOf(state, cmd.seat);
      if (target.eliminated || cmd.seat === state.lieutenant || cmd.seat === state.captain) {
        throw new RuleError('BAD_TARGET', '不能选择该玩家为紧急领航员');
      }
      state.navigator = cmd.seat;
      state.pending.pop();
      pushLog(state, `船长指定 ${describePlayer(state, cmd.seat)} 为紧急领航员，立即重新航海（无忠诚质询）。`);
      startNavigation(state, rng, true);
      break;
    }
    case 'choosePlayer':
      handleChoosePlayer(state, rng, pending, seatId, cmd);
      break;
    case 'floggingSelfDeclare': {
      if (cmd.type !== 'floggingDeclare') throw badCmd();
      state.pending.pop();
      const target = seatOf(state, seatId);
      const other: Faction[] =
        cmd.declares === 'sailor'
          ? (['pirate', 'cult'] as Faction[])
          : cmd.declares === 'pirate'
            ? (['sailor', 'cult'] as Faction[])
            : (['sailor', 'pirate'] as Faction[]);
      const revealed = other[rng.int(2)];
      target.flogged = true;
      if (!target.notFactions.includes(revealed)) target.notFactions.push(revealed);
      const zh: Record<string, string> = { sailor: '水手', pirate: '海盗', cult: '邪教' };
      pushLog(state, `鞭刑：${nameOf(state, seatId)} 公开了「我不是${zh[revealed]}」。`);
      target.characterId = target.characterId; // no-op
      continueAfterMapAction(state, rng);
      break;
    }
    case 'gunsStash': {
      if (cmd.type !== 'allocateGuns') throw badCmd();
      const alloc = cmd.alloc;
      let total = 0;
      for (const k of Object.keys(alloc)) {
        const s = Number(k);
        const cnt = alloc[s];
        if (!Number.isInteger(cnt) || cnt < 0) throw new RuleError('BAD_ALLOC', '分配数量非法');
        if (seatOf(state, s).eliminated) throw new RuleError('BAD_ALLOC', '不能分配给已出局玩家');
        total += cnt;
      }
      if (total !== 3) throw new RuleError('BAD_ALLOC', '必须恰好分配 3 把枪');
      if (state.gunSupply < 3) throw new RuleError('BAD_ALLOC', '供应区枪不足');
      for (const k of Object.keys(alloc)) seatOf(state, Number(k)).guns += alloc[Number(k)];
      state.gunSupply -= 3;
      state.pending.pop();
      pushLog(state, '邪教仪式「邪教军火库」：3 把枪已被秘密分发。');
      state.stage = 'offDuty';
      break;
    }
    case 'telescopeDecision': {
      if (cmd.type !== 'telescopeDecision') throw badCmd();
      state.pending.pop();
      const src = pending.data.src as 'telescope' | 'lookout';
      if (cmd.discard) {
        const card = state.navDeck.shift()!;
        state.navDiscard.push(card);
        state.recentDiscards.push(card);
        if (state.recentDiscards.length > 3) state.recentDiscards.shift();
        pushLog(state, `${nameOf(state, seatId)} 将观察到的牌面朝下弃入深海。`);
      } else {
        pushLog(state, `${nameOf(state, seatId)} 将观察到的牌放回牌堆顶。`);
      }
      if (src === 'telescope') afterCardAction(state, rng);
      break;
    }
    case 'instigatorAnswer': {
      if (cmd.type !== 'instigatorAnswer') throw badCmd();
      state.pending.pop();
      state.mutiny.instigatorAnswerPending = false;
      const target = seatOf(state, seatId);
      if (cmd.join) {
        const joined = target.guns;
        target.guns = 0;
        state.mutiny.submissions[seatId] = (state.mutiny.submissions[seatId] ?? 0) + joined;
        pushLog(state, `${nameOf(state, seatId)} 将全部 ${joined} 把枪加入了哗变！`);
      } else {
        pushLog(state, `${nameOf(state, seatId)} 拒绝加入哗变。`);
        const instigator = state.players.find(
          (p) => p.characterId === 'chr_instigator' && p.characterRevealed,
        );
        if (instigator) instigator.characterRevealed = false; // 哗变后翻面（可再启动）
      }
      break;
    }
    default:
      throw badCmd();
  }
}

function validateAppoint(state: GameState, lieutenant: number, navigator: number) {
  if (!canAppoint(state, lieutenant, 'lieutenant')) {
    throw new RuleError('BAD_TARGET', '副手人选不合法（不能是自己/停职/出局）');
  }
  if (!canAppoint(state, navigator, 'navigator')) {
    throw new RuleError('BAD_TARGET', '领航员人选不合法（不能是自己/副手/停职/出局）');
  }
}

// ============ 激活窗口 ============

function windowKindMatches(state: GameState, timing: string, wk: string): boolean {
  if (timing === 'anytime' || timing === 'gunCost') return true;
  if (timing === 'beforeAppointment') return wk === 'beforeAppointment';
  if (timing === 'afterAppointment') return wk === 'afterAppointment';
  if (timing === 'beforeDraw') return wk === 'beforeDraw';
  if (timing === 'afterReveal') return wk === 'afterReveal';
  if (timing === 'yellowRound') return wk === 'yellowRound' && state.yellowPlayedThisRound;
  return false;
}

export function computeActivationOptions(state: GameState): { seatId: number; characterId: string }[] {
  const out: { seatId: number; characterId: string }[] = [];
  if (!state.activation) return out;
  const wk = state.activation.windowKind;
  for (const p of alivePlayers(state)) {
    const cid = p.characterId;
    if (!cid || p.characterRevealed) continue;
    const def = CHARACTER_MAP[cid];
    if (!def) continue;
    if (!windowKindMatches(state, def.timing, wk)) continue;
    if (!characterUsable(state, p, cid)) continue;
    out.push({ seatId: p.seatId, characterId: cid });
  }
  return out;
}

function characterUsable(state: GameState, p: PlayerState, cid: string): boolean {
  switch (cid) {
    case 'chr_kleptomaniac':
      return alivePlayers(state).some((q) => q.seatId !== p.seatId && q.guns >= 1);
    case 'chr_gunslinger':
      return state.gunSupply >= 2;
    case 'chr_gunsmith':
      return p.guns >= 1;
    case 'chr_herbalist':
      return (
        alivePlayers(state).some((q) => q.offDuty) &&
        alivePlayers(state).filter((q) => !q.offDuty).length >= 2
      );
    case 'chr_consultant':
      return (
        alivePlayers(state).filter((q) => canAppoint(state, q.seatId, 'lieutenant')).length > 0
      );
    case 'chr_bosun':
      return lieutenantValid(state) && navigatorValid(state);
    case 'chr_smuggler':
    case 'chr_archivist':
      return lieutenantValid(state);
    case 'chr_minstrel':
    case 'chr_agitator':
      return alivePlayers(state).filter((q) => q.seatId !== state.captain).length >= 2;
    case 'chr_debt_collector':
      return (
        [state.captain, state.lieutenant, state.navigator].filter(
          (s) => s >= 0 && !seatOf(state, s).eliminated,
        ).length >= 2
      );
    case 'chr_spiritualist':
      return alivePlayers(state).filter((q) => q.guns >= 1).length >= 1;
    case 'chr_mentor':
      return alivePlayers(state).some((q) => q.characterId && q.characterId !== 'chr_captain');
    case 'chr_lookout':
      return state.navDeck.length >= 1 || state.navDiscard.length >= 1;
    case 'chr_peacemaker':
    case 'chr_troublemaker':
      // 目标过滤器 mutinyRevealed 要求目标本次揭示了枪；无人出枪时不可发动，
      // 否则会推出零合法候选的 choosePlayer 挂起且无法 pass，导致死锁。
      return Object.values(state.mutiny.submissions).some((v) => (v ?? 0) > 0);
    default:
      return true;
  }
}

function handleWindowCommand(state: GameState, rng: Rng, seatId: number, cmd: Command) {
  const win = state.activation;
  if (!win) throw new RuleError('NO_WINDOW', '当前没有开放的操作窗口');
  const player = seatOf(state, seatId);
  if (player.eliminated) throw new RuleError('ELIMINATED', '已出局玩家无法响应');
  if (cmd.type === 'pass') {
    if (!win.passedSeats.includes(seatId)) win.passedSeats.push(seatId);
    return;
  }
  if (cmd.type === 'activateCharacter') {
    const opt = computeActivationOptions(state).find(
      (o) => o.seatId === seatId && o.characterId === cmd.characterId,
    );
    if (!opt) throw new RuleError('NOT_ACTIVATABLE', '该角色当前不可启动');
    activateCharacter(state, rng, seatId, cmd.characterId);
    win.passedSeats = win.passedSeats.filter((s) => s !== seatId);
    return;
  }
  throw badCmd();
}

function autoPassExhausted(state: GameState) {
  const win = state.activation;
  if (!win) return;
  const opts = computeActivationOptions(state);
  for (const p of alivePlayers(state)) {
    const hasOptions = opts.some((o) => o.seatId === p.seatId);
    if (!hasOptions && !win.passedSeats.includes(p.seatId)) win.passedSeats.push(p.seatId);
  }
}

function windowComplete(state: GameState): boolean {
  if (!state.activation) return true;
  autoPassExhausted(state);
  return alivePlayers(state).every((p) => state.activation!.passedSeats.includes(p.seatId));
}

function activateCharacter(state: GameState, rng: Rng, seatId: number, cid: string) {
  const p = seatOf(state, seatId);
  const def = CHARACTER_MAP[cid];
  if (!def) throw new RuleError('BAD_CHARACTER', '未知角色');
  if (def.timing === 'gunCost') {
    if (p.guns < 1) throw new RuleError('NO_GUNS', '你没有足够的枪');
    p.guns -= 1;
    state.gunSupply += 1;
    if (!state.gunsmithActive.includes(seatId)) state.gunsmithActive.push(seatId);
    p.characterRevealed = true;
    pushLog(state, `${describePlayer(state, seatId)} 亮出角色牌「${def.nameZh}」（弃1把枪）。`);
    return;
  }
  p.characterRevealed = true;
  pushLog(state, `${describePlayer(state, seatId)} 亮出角色牌「${def.nameZh}」。`);
  switch (cid) {
    case 'chr_gunslinger':
      p.guns += 2;
      state.gunSupply -= 2;
      break;
    case 'chr_kleptomaniac':
      pushPending(state, {
        kind: 'choosePlayer',
        actorSeat: seatId,
        data: { filter: 'hasGuns', effect: 'kleptomaniac' },
        reasonZh: '窃癖者：选择一名玩家偷取1把枪',
      });
      break;
    case 'chr_mentor':
      pushPending(state, {
        kind: 'choosePlayer',
        actorSeat: seatId,
        data: { filter: 'anyAliveWithCharacter', effect: 'mentor' },
        reasonZh: '导师：选择一名玩家，其角色牌翻回背面',
      });
      break;
    case 'chr_lookout':
      if (state.navDeck.length === 0) reshuffleDeck(state, rng);
      if (state.navDeck.length === 0) {
        pushLog(state, '瞭望员：牌堆与弃牌均为空，无牌可看。');
        break;
      }
      pushPending(state, {
        kind: 'telescopeDecision',
        actorSeat: seatId,
        // 只会由视图投影下发给 actor；其他玩家收到 null，不能看到牌堆顶。
        data: { src: 'lookout', cardPreview: state.navDeck[0] },
        reasonZh: '瞭望员：查看抽牌堆顶的导航牌（弃掉或放回）',
      });
      break;
    case 'chr_herbalist':
      pushPending(state, {
        kind: 'choosePlayer',
        actorSeat: seatId,
        data: { filter: 'offDutySource', effect: 'herbalistSource' },
        reasonZh: '草药师：选择一名当前停职的玩家（停职牌将被转移）',
      });
      break;
    case 'chr_consultant':
      pushPending(state, {
        kind: 'consultantLieutenant',
        actorSeat: seatId,
        data: {},
        reasonZh: '顾问：指定新任副手',
      });
      break;
    case 'chr_bosun': {
      const lt = state.lieutenant;
      state.lieutenant = state.navigator;
      state.navigator = lt;
      pushLog(state, `水手长发动：副手与领航员职位互换。`);
      break;
    }
    case 'chr_smuggler':
      pushPending(state, {
        kind: 'choosePlayer',
        actorSeat: seatId,
        data: { filter: 'captainOrLieutenant', effect: 'smuggler' },
        reasonZh: '走私者：选择船长或副手，其本次抽3张导航牌',
      });
      break;
    case 'chr_archivist':
      pushPending(state, {
        kind: 'choosePlayer',
        actorSeat: seatId,
        data: { filter: 'captainOrLieutenant', effect: 'archivist' },
        reasonZh: '档案员：选择船长或副手（其抽牌后可弃牌重抽）',
      });
      break;
    case 'chr_minstrel':
      pushPending(state, {
        kind: 'choosePlayer',
        actorSeat: seatId,
        data: { filter: 'aliveExceptCaptain', effect: 'minstrel', slot: 1, chosen: [] },
        reasonZh: '吟游诗人：选择第一名不参与下次哗变的玩家',
      });
      break;
    case 'chr_agitator':
      pushPending(state, {
        kind: 'choosePlayer',
        actorSeat: seatId,
        data: { filter: 'agitatorTarget', effect: 'agitator', slot: 1, chosen: [] },
        reasonZh: '煽动者：选择第一名下次哗变须至少出1枪的玩家',
      });
      break;
    case 'chr_debt_collector':
      pushPending(state, {
        kind: 'choosePlayer',
        actorSeat: seatId,
        data: { filter: 'navTeamMember', effect: 'debtCollector' },
        reasonZh: '讨债人：选择航海组中的一名玩家收债',
      });
      break;
    case 'chr_equalizer':
      state.nextMutinyModifiers.equalizer = true;
      break;
    case 'chr_chief_cook': {
      const newCap = pickFewestResume(state, true);
      state.activation = null;
      state.pending.length = 0;
      if (newCap < 0 || newCap === state.captain) {
        pushLog(state, '主厨发动但没有产生变化。');
        state.stage = 'appoint';
        break;
      }
      state.captain = newCap;
      state.lieutenant = -1;
      state.navigator = -1;
      pushLog(state, `主厨发动：船长职移交给 ${describePlayer(state, newCap)}，重新任命航海组。`);
      state.stage = 'appoint';
      break;
    }
    case 'chr_spiritualist':
      pushPending(state, {
        kind: 'choosePlayer',
        actorSeat: seatId,
        data: { filter: 'hasGuns', effect: 'spiritualistPick' },
        reasonZh: '通灵者：选择第一名交枪玩家',
      });
      break;
    case 'chr_troublemaker':
      pushPending(state, {
        kind: 'choosePlayer',
        actorSeat: seatId,
        data: { filter: 'mutinyRevealed', effect: 'troublemaker' },
        reasonZh: '捣乱者：选择一名玩家，其枪数翻倍计算',
      });
      break;
    case 'chr_peacemaker':
      pushPending(state, {
        kind: 'choosePlayer',
        actorSeat: seatId,
        data: { filter: 'mutinyRevealed', effect: 'peacemaker' },
        reasonZh: '和平使者：选择一名玩家收回其揭示的枪',
      });
      break;
    case 'chr_master_strategist':
      pushLog(state, '大战略家发动：若未成为新船长，将收回自己揭示的枪。');
      break;
    case 'chr_rabble_rouser':
      state.mutiny.rabbleRouserActive = true;
      break;
    case 'chr_instigator':
      pushPending(state, {
        kind: 'choosePlayer',
        actorSeat: seatId,
        data: { filter: 'aliveExceptSelfAndCaptain', effect: 'instigator' },
        reasonZh: '教唆者：选择一名玩家（不能是船长）',
      });
      break;
    default:
      break;
  }
}

// ============ choosePlayer 效果 ============

function handleChoosePlayer(state: GameState, rng: Rng, pending: PendingChoice, seatId: number, cmd: Command) {
  if (cmd.type !== 'choosePlayer') throw badCmd();
  const filter = pending.data.filter as string;
  const effect = pending.data.effect as string;
  const target = seatOf(state, cmd.seat);
  validateTarget(state, seatId, filter, target, pending);
  state.pending.pop();

  switch (effect) {
    case 'kleptomaniac':
      target.guns -= 1;
      seatOf(state, seatId).guns += 1;
      pushLog(state, `窃癖者：${nameOf(state, seatId)} 从 ${nameOf(state, target.seatId)} 处取走了1把枪。`);
      break;
    case 'mentor':
      target.characterRevealed = false;
      pushLog(state, `导师：${nameOf(state, target.seatId)} 的角色牌被翻回背面（可再次启动）。`);
      break;
    case 'herbalistSource':
      pushPending(state, {
        kind: 'choosePlayer',
        actorSeat: seatId,
        data: { filter: 'notOffDuty', effect: 'herbalistTarget', source: target.seatId },
        reasonZh: '草药师：选择接替停职的玩家',
      });
      break;
    case 'herbalistTarget': {
      const srcSeat = pending.data.source as number;
      seatOf(state, srcSeat).offDuty = false;
      target.offDuty = true;
      pushLog(state, `草药师：停职牌由 ${nameOf(state, srcSeat)} 转移给 ${nameOf(state, target.seatId)}。`);
      break;
    }
    case 'smuggler':
      state.navigation.smugglerSeat = target.seatId;
      pushLog(state, `走私者：${nameOf(state, target.seatId)} 本次航海将抽3张导航牌。`);
      break;
    case 'archivist':
      state.navigation.archivistSeat = target.seatId;
      pushLog(state, `档案员：${nameOf(state, target.seatId)} 抽牌后可弃牌重抽。`);
      break;
    case 'minstrel': {
      const chosen = (pending.data.chosen as number[]) || [];
      chosen.push(target.seatId);
      if (pending.data.slot === 1) {
        pushPending(state, {
          kind: 'choosePlayer',
          actorSeat: seatId,
          data: { filter: 'aliveExceptCaptain', effect: 'minstrel', slot: 2, chosen },
          reasonZh: '吟游诗人：选择第二名不参与下次哗变的玩家',
        });
      } else {
        state.nextMutinyModifiers.excludedSeats = chosen;
        pushLog(state, `吟游诗人：${chosen.map((s) => nameOf(state, s)).join('、')} 将不参与下次哗变。`);
      }
      break;
    }
    case 'agitator': {
      const chosen = (pending.data.chosen as number[]) || [];
      chosen.push(target.seatId);
      if (pending.data.slot === 1) {
        pushPending(state, {
          kind: 'choosePlayer',
          actorSeat: seatId,
          data: { filter: 'agitatorTarget', effect: 'agitator', slot: 2, chosen },
          reasonZh: '煽动者：选择第二名下次哗变须至少出1枪的玩家',
        });
      } else {
        for (const s of chosen) state.nextMutinyModifiers.forcedMinBySeat[s] = 1;
        pushLog(state, `煽动者：${chosen.map((s) => nameOf(state, s)).join('、')} 下次哗变须各至少出1枪。`);
      }
      break;
    }
    case 'debtCollector': {
      const team = [state.captain, state.lieutenant, state.navigator].filter(
        (s) => s >= 0 && s !== target.seatId && !seatOf(state, s).eliminated,
      );
      let given = 0;
      for (const s of team) {
        if (target.guns > 0) {
          target.guns -= 1;
          seatOf(state, s).guns += 1;
          given++;
        }
      }
      pushLog(state, `讨债人：${nameOf(state, target.seatId)} 向航海组其他成员支付了 ${given} 把枪。`);
      break;
    }
    case 'spiritualistPick':
      pushPending(state, {
        kind: 'choosePlayer',
        actorSeat: seatId,
        data: { filter: 'anyAlive', effect: 'spiritualistTarget2', first: target.seatId },
        reasonZh: '通灵者：选择第二名交枪玩家',
      });
      break;
    case 'spiritualistTarget2': {
      const first = pending.data.first as number;
      pushPending(state, {
        kind: 'choosePlayer',
        actorSeat: seatId,
        data: { filter: 'anyAlive', effect: 'spiritualistRecipient', payers: [first, target.seatId] },
        reasonZh: '通灵者：选择收枪的玩家',
      });
      break;
    }
    case 'spiritualistRecipient': {
      const payers = pending.data.payers as number[];
      let moved = 0;
      for (const s of payers) {
        const payer = seatOf(state, s);
        if (payer.guns > 0) {
          payer.guns -= 1;
          target.guns += 1;
          moved++;
        }
      }
      pushLog(state, `通灵者：${moved} 把枪被转移给 ${nameOf(state, target.seatId)}。`);
      break;
    }
    case 'troublemaker':
      state.mutiny.troublemakerTarget = target.seatId;
      pushLog(state, `捣乱者：${nameOf(state, target.seatId)} 的枪将翻倍计算。`);
      break;
    case 'peacemaker':
      state.mutiny.peacemakerTarget = target.seatId;
      pushLog(state, `和平使者：${nameOf(state, target.seatId)} 揭示的枪不计入本次哗变。`);
      break;
    case 'instigator':
      state.mutiny.instigatorTarget = target.seatId;
      state.mutiny.instigatorAnswerPending = true;
      pushPending(state, {
        kind: 'instigatorAnswer',
        actorSeat: target.seatId,
        data: {},
        reasonZh: '教唆者怂恿：是否将你的全部枪加入本次哗变？',
      });
      break;
    // ===== 地图行动 =====
    case 'cabinSearch': {
      target.cabinSearched = true;
      const f = target.faction;
      const zh: Record<string, string> = { sailor: '水手', pirate: '海盗', cultLeader: '邪教主', cultist: '邪教徒' };
      pushLog(state, `舱室搜查：${nameOf(state, state.captain)} 秘密检查了 ${nameOf(state, target.seatId)} 的海员袋。`);
      pushLog(
        state,
        `舱室搜查结果：${nameOf(state, target.seatId)} 的阵营是「${f ? zh[f] : '未知'}」。你可以公布真相，也可以撒谎。`,
        state.captain,
      );
      continueAfterMapAction(state, rng);
      break;
    }
    case 'offWithTongue':
      target.noTongue = true;
      pushLog(state, `割舌：${nameOf(state, target.seatId)} 被割舌——不能再成为船长；今后确定新船长时其枪数按0计。`);
      continueAfterMapAction(state, rng);
      break;
    case 'feedTheKraken': {
      if (target.seatId === state.captain) {
        pushPending(state, pending); // 回滚：validateTarget 已挡，这里兜底
        throw new RuleError('BAD_TARGET', '船长不能将自己献祭');
      }
      target.eliminated = true;
      target.eliminationReason = 'kraken';
      if (state.navigator === target.seatId) state.navigator = -1;
      if (state.lieutenant === target.seatId) state.lieutenant = -1;
      pushLog(state, `献祭海妖：${nameOf(state, target.seatId)} 被投入海中，立即出局！`);
      if (target.faction === 'cultLeader') {
        endGame(state, 'cult', `邪教主 ${nameOf(state, target.seatId)} 被献祭给海妖，邪教立即获胜！`);
        return;
      }
      continueAfterMapAction(state, rng);
      break;
    }
    case 'flogging':
      pushPending(state, {
        kind: 'floggingSelfDeclare',
        actorSeat: target.seatId,
        data: {},
        reasonZh: '鞭刑：请秘密声明你当前的阵营（水手/海盗/邪教）',
      });
      break;
    case 'mermaid': {
      const cards = state.recentDiscards.slice(-3);
      const names = cards.map(cardNameZh).join('、');
      pushLog(state, `美人鱼：${nameOf(state, target.seatId)} 秘密查看了最近弃掉的导航牌。`);
      pushLog(state, `你看到的最近三张弃牌：${names || '（无）'}。你可以自由谈论（或撒谎）。`, target.seatId);
      afterCardAction(state, rng);
      break;
    }
    case 'telescope': {
      if (state.navDeck.length === 0) reshuffleDeck(state, rng);
      if (state.navDeck.length === 0) {
        pushLog(state, '望远镜：牌堆与弃牌均为空，无牌可看。');
        afterCardAction(state, rng);
        break;
      }
      const card = state.navDeck[0];
      pushLog(state, `望远镜：${nameOf(state, target.seatId)} 查看了抽牌堆顶的导航牌。`);
      pushLog(state, `你看到牌堆顶是「${cardNameZh(card)}」。`, target.seatId);
      pushPending(state, {
        kind: 'telescopeDecision',
        actorSeat: target.seatId,
        // 只会由视图投影下发给 actor；其他玩家收到 null，不能看到牌堆顶。
        data: { src: 'telescope', cardPreview: card },
        reasonZh: `望远镜：牌堆顶是「${cardNameZh(card)}」，弃掉还是放回？`,
      });
      break;
    }
    case 'conversionToCult':
      if (!isConvertible(target)) throw new RuleError('BAD_TARGET', '该玩家不可被皈依');
      target.faction = 'cultist';
      state.convertedCultists ??= [];
      if (!state.convertedCultists.includes(target.seatId)) state.convertedCultists.push(target.seatId);
      pushLog(state, '皈依邪教：一名玩家被秘密吸收进邪教。');
      pushLog(state, '你已成为邪教徒！从此与邪教主同生共死。', target.seatId);
      pushLog(state, `皈依完成：你的新信徒是 ${nameOf(state, target.seatId)}。`, findCultLeader(state));
      state.stage = 'offDuty';
      break;
    default:
      break;
  }
}

function validateTarget(
  state: GameState,
  actorSeat: number,
  filter: string,
  target: PlayerState,
  pending: PendingChoice,
) {
  const isSelf = target.seatId === actorSeat;
  const alive = !target.eliminated;
  const fail = (msg: string): never => {
    throw new RuleError('BAD_TARGET', msg);
  };
  switch (filter) {
    case 'anyAliveExceptSelf':
      if (!alive || isSelf) fail('必须选择另一名在场玩家');
      break;
    case 'anyAlive':
      if (!alive) fail('必须选择在场玩家');
      break;
    case 'hasGuns':
      if (!alive || isSelf) fail('必须选择另一名在场玩家');
      if (target.guns < 1) fail('该玩家没有枪');
      break;
    case 'anyAliveWithCharacter':
      if (!alive) fail('必须选择在场玩家');
      if (!target.characterId || target.characterId === 'chr_captain') fail('该玩家没有可翻面的角色牌');
      break;
    case 'offDutySource':
      if (!alive || !target.offDuty) fail('必须选择当前停职的玩家');
      break;
    case 'notOffDuty':
      if (!alive || target.offDuty) fail('必须选择不在停职的玩家');
      if (target.seatId === pending.data.source) fail('不能选择原停职玩家');
      break;
    case 'captainOrLieutenant':
      if (!alive) fail('必须选择在场玩家');
      if (target.seatId !== state.captain && target.seatId !== state.lieutenant)
        fail('必须选择船长或副手');
      break;
    case 'aliveExceptCaptain':
      if (!alive || target.seatId === state.captain) fail('不能选择船长');
      if (((pending.data.chosen as number[]) || []).includes(target.seatId)) fail('该玩家已被选择');
      break;
    case 'agitatorTarget':
      if (!alive || target.seatId === state.captain) fail('对船长无效，请选择其他玩家');
      if (state.nextMutinyModifiers.excludedSeats.includes(target.seatId))
        fail('被吟游诗人排除的玩家不受煽动影响');
      if (((pending.data.chosen as number[]) || []).includes(target.seatId)) fail('该玩家已被选择');
      break;
    case 'aliveExceptSelfAndCaptain':
      if (!alive || isSelf || target.seatId === state.captain) fail('不能选择自己或船长');
      break;
    case 'mutinyRevealed':
      if (!alive) fail('必须选择在场玩家');
      if ((state.mutiny.submissions[target.seatId] ?? 0) <= 0) fail('该玩家本次没有揭示任何枪');
      break;
    case 'navTeamMember':
      if (!alive) fail('必须选择在场玩家');
      if (![state.captain, state.lieutenant, state.navigator].includes(target.seatId))
        fail('必须选择航海组成员');
      break;
    case 'mapActionTarget':
      if (!alive || isSelf) fail('船长必须选择另一名在场玩家');
      break;
    case 'convertible':
      if (!isConvertible(target)) fail('该玩家不可被皈依（已被舱搜/鞭刑，或已属邪教）');
      break;
    default:
      if (!alive) fail('必须选择在场玩家');
  }
}

// ============ 主阶段推进 ============

export function advance(state: GameState, rng: Rng) {
  let guard = 0;
  while (!state.result && guard++ < 200) {
    if (state.pending.length > 0) return;
    if (state.activation) {
      if (windowComplete(state)) {
        const wk = state.activation.windowKind;
        state.activation = null;
        afterWindow(state, wk);
        continue;
      }
      return;
    }
    switch (state.stage) {
      case 'roundStart':
        openWindow(state, rng, 'beforeAppointment');
        continue;
      case 'appointConsultant':
        pushPending(state, {
          kind: 'appointTeam',
          actorSeat: state.captain,
          data: { navigatorOnly: true },
          reasonZh: '请任命领航员（副手已由顾问指定）',
        });
        return;
      case 'appoint':
        if (alivePlayers(state).length < 3) {
          pushLog(state, '存活船员不足3人：航海组的空缺职位将以随机方式代替决策。');
          beginMutinyPhase(state);
          continue;
        }
        pushPending(state, {
          kind: 'appointTeam',
          actorSeat: state.captain,
          data: {},
          reasonZh: '请任命副手与领航员',
        });
        return;
      case 'afterAppoint':
        openWindow(state, rng, 'afterAppointment');
        continue;
      case 'mutinySubmit':
        beginMutinySubmit(state);
        continue;
      case 'mutinyReveal':
        resolveMutinyReveal(state);
        continue;
      case 'mutinyResolve':
        resolveMutinyOutcome(state);
        continue;
      case 'preDraw':
        openWindow(state, rng, 'beforeDraw');
        continue;
      case 'draw':
        doDraw(state, rng);
        continue;
      case 'navCaptainDiscard': {
        if (state.navigation.archivistSeat === state.captain) {
          state.navigation.archivistSeat = null;
          pushPending(state, {
            kind: 'chooseCard',
            actorSeat: state.captain,
            data: { archivistRedraw: true, role: 'captain' },
            reasonZh: '档案员：你可以弃掉刚抽的导航牌并重抽2张',
          });
          return;
        }
        pushPending(state, {
          kind: 'chooseCard',
          actorSeat: state.captain,
          data: { cards: state.navigation.captainCards.slice(), stage: 'captain' },
          reasonZh: '船长：选择一张导航牌面朝下弃入深海',
        });
        return;
      }
      case 'navLieutenantDiscard': {
        if (!lieutenantValid(state)) {
          state.navigation.lieutenantDiscarded = [];
          state.stage = 'navNavigator';
          continue;
        }
        if (state.navigation.archivistSeat === state.lieutenant) {
          state.navigation.archivistSeat = null;
          pushPending(state, {
            kind: 'chooseCard',
            actorSeat: state.lieutenant,
            data: { archivistRedraw: true, role: 'lieutenant' },
            reasonZh: '档案员：你可以弃掉刚抽的导航牌并重抽2张',
          });
          return;
        }
        pushPending(state, {
          kind: 'chooseCard',
          actorSeat: state.lieutenant,
          data: { cards: state.navigation.lieutenantCards.slice(), stage: 'lieutenant' },
          reasonZh: '副手：选择一张导航牌面朝下弃入深海',
        });
        return;
      }
      case 'navNavigator':
        prepareLogbook(state, rng);
        continue;
      case 'navCaptainReveal':
        pushPending(state, {
          kind: 'captainReveal',
          actorSeat: state.captain,
          data: {},
          reasonZh: '领航员已完成选择：请船长公开并执行最终导航牌',
        });
        return;
      case 'resolveNavCard':
        resolveNavCard(state, rng);
        continue;
      case 'yellowWindow':
        // 窗口由 activation 机制处理；落到这里说明窗口已关且无仪式
        if (state.cultRitual.pendingRitual) {
          executeRitual(state, rng);
        } else {
          state.stage = 'offDuty';
        }
        continue;
      case 'offDuty':
        applyOffDuty(state);
        continue;
      case 'roundEnd':
        nextRound(state);
        continue;
      default:
        return;
    }
  }
}

function afterWindow(state: GameState, wk: string) {
  switch (wk) {
    case 'beforeAppointment':
      if (state.stage !== 'appointConsultant') state.stage = 'appoint';
      break;
    case 'afterAppointment':
      state.stage = 'mutinySubmit';
      break;
    case 'beforeDraw':
      state.stage = 'draw';
      break;
    case 'afterReveal':
      state.stage = 'mutinyResolve';
      break;
    case 'yellowRound':
      state.stage = 'yellowWindow';
      break;
    default:
      break;
  }
}

function openWindow(
  state: GameState,
  rng: Rng,
  kind: 'beforeAppointment' | 'afterAppointment' | 'beforeDraw' | 'afterReveal' | 'yellowRound' | 'free',
) {
  state.activation = { windowKind: kind, passedSeats: [], options: [] };
}

// ============ 哗变 ============

function beginMutinyPhase(state: GameState) {
  state.stage = 'afterAppoint';
}

function computeThreshold(state: GameState): number {
  if (state.nextMutinyModifiers.equalizer) return 1;
  return mutinyThreshold(state.playerCount);
}

function beginMutinySubmit(state: GameState) {
  const threshold = computeThreshold(state);
  state.mutiny = freshMutiny(threshold);
  state.mutiny.excludedFromMutiny = state.nextMutinyModifiers.excludedSeats.slice();
  state.mutiny.forcedMinBySeat = { ...state.nextMutinyModifiers.forcedMinBySeat };
  state.mutiny.equalizerActive = state.nextMutinyModifiers.equalizer;
  if (state.mutiny.equalizerActive) state.mutiny.maxRevealPerPlayer = 1;
  state.nextMutinyModifiers = { excludedSeats: [], forcedMinBySeat: {}, equalizer: false };
  state.mutiny.stage = 'submitting';
  const eligible = mutinyEligible(state);
  pushLog(state, `忠诚质询：船长质询船员是否满意任命（成功哗变需 ${threshold} 把枪）。`);
  if (eligible.length === 0) {
    state.mutiny.stage = 'revealed';
    state.mutiny.succeeded = false;
    state.stage = 'mutinyResolve';
    return;
  }
  state.stage = 'mutinySubmitWait';
  for (const seatId of eligible) state.mutiny.submissions[seatId] = null;
  pushPending(state, {
    kind: 'mutinySubmit',
    actorSeat: -1,
    data: { eligible },
    reasonZh: '请玩家选择缴械枪数',
  });
}

export function mutinyEligible(state: GameState): number[] {
  return alivePlayers(state)
    .filter((p) => p.seatId !== state.captain && !state.mutiny.excludedFromMutiny.includes(p.seatId))
    .map((p) => p.seatId);
}

function handleMutinySubmit(state: GameState, seatId: number, count: number) {
  const p = seatOf(state, seatId);
  const eligible = mutinyEligible(state);
  if (!eligible.includes(seatId)) {
    throw new RuleError('NOT_ELIGIBLE', '你不能参加本次忠诚质询');
  }
  const existing = state.mutiny.submissions[seatId];
  if (existing !== undefined && existing !== null) {
    throw new RuleError('ALREADY_SUBMITTED', '你已经提交过枪数');
  }
  if (!Number.isInteger(count) || count < 0) throw new RuleError('BAD_COUNT', '枪数非法');
  const max = state.mutiny.maxRevealPerPlayer ?? p.guns;
  if (count > max) {
    throw new RuleError(
      'TOO_MANY_GUNS',
      state.mutiny.maxRevealPerPlayer ? '平权者效果：每人至多出1把枪' : '你没有那么多枪',
    );
  }
  const forcedMin = Math.min(state.mutiny.forcedMinBySeat[seatId] ?? 0, p.guns);
  if (count < forcedMin) {
    throw new RuleError('FORCED_MIN', `煽动者要求你至少出 ${forcedMin} 把枪`);
  }
  state.mutiny.submissions[seatId] = count;
  state.mutiny.submittedOrder.push(seatId);
  p.guns -= count; // 枪放上桌（失败时收回，成功哗变后按规则弃掉）
  const waiting = eligible.find((s) => {
    const v = state.mutiny.submissions[s];
    return v === undefined || v === null;
  });
  if (waiting === undefined) {
    state.pending.pop();
    state.stage = 'mutinyReveal';
  }
}

function resolveMutinyReveal(state: GameState) {
  let total = 0;
  for (const s of mutinyEligible(state)) total += state.mutiny.submissions[s] ?? 0;
  state.mutiny.stage = 'revealed';
  state.mutiny.revealedTotal = total;
  const detail = mutinyContributors(state)
    .map((s) => `${nameOf(state, s)}:${state.mutiny.submissions[s] ?? 0}`)
    .join('，');
  pushLog(state, `所有枪同时揭示：${detail}。合计 ${total} 把。`);
  openWindow(state, SeededRng.fromState(state.seededRngState), 'afterReveal');
}

// 所有上桌的贡献者：有资格者 + 被教唆者拉入的被排除者
function mutinyContributors(state: GameState): number[] {
  const out = new Set<number>(mutinyEligible(state));
  for (const s of Object.keys(state.mutiny.submissions)) {
    const seat = Number(s);
    if ((state.mutiny.submissions[seat] ?? 0) > 0) out.add(seat);
  }
  return [...out];
}

function effectiveTotal(state: GameState): number {
  let total = 0;
  for (const s of mutinyContributors(state)) {
    if (s === state.mutiny.peacemakerTarget) continue;
    let guns = state.mutiny.submissions[s] ?? 0;
    if (s === state.mutiny.troublemakerTarget) guns *= 2;
    total += guns;
  }
  return total;
}

function countedGunsForCaptain(state: GameState, seatId: number): number {
  if (seatOf(state, seatId).noTongue) return 0;
  if (seatId === state.mutiny.peacemakerTarget) return 0;
  let guns = state.mutiny.submissions[seatId] ?? 0;
  if (seatId === state.mutiny.troublemakerTarget) guns *= 2;
  return guns;
}

function resolveMutinyOutcome(state: GameState) {
  const total = effectiveTotal(state);
  state.mutiny.revealedTotal = total;
  let threshold = mutinyThreshold(state.playerCount);
  if (state.mutiny.rabbleRouserActive) threshold = Math.ceil(threshold / 2);
  if (state.mutiny.equalizerActive) threshold = 1;
  state.mutiny.threshold = threshold;
  state.mutiny.succeeded = total >= threshold;
  if (state.mutiny.instigatorAnswerPending) state.mutiny.instigatorAnswerPending = false;
  if (!state.mutiny.succeeded) {
    pushLog(state, `哗变失败（${total}/${threshold}）。所有枪收回，航海组继续执行航海。`);
    cleanupMutiny(state, true, state.captain, false);
    state.stage = 'preDraw';
    return;
  }
  pushLog(state, `哗变成功（${total}/${threshold}）！`);
  const candidates = mutinyContributors(state).filter((s) => (state.mutiny.submissions[s] ?? 0) > 0);
  if (candidates.length === 0) {
    cleanupMutiny(state, true, state.captain, true);
    finishMutiny(state, state.captain);
    return;
  }
  const maxGuns = Math.max(...candidates.map((s) => countedGunsForCaptain(state, s)));
  const tied = candidates.filter((s) => countedGunsForCaptain(state, s) === maxGuns);
  if (tied.length === 1) {
    cleanupMutiny(state, true, tied[0], true);
    finishMutiny(state, tied[0]);
  } else {
    state.mutiny.tieChain = tied.slice();
    // 枪的结算推迟到平局链结束
    pushLog(state, `平局：${tied.map((s) => nameOf(state, s)).join('、')} 并列最多，依次指定退出者。`);
    pushPending(state, {
      kind: 'tiePick',
      actorSeat: state.captain,
      data: { candidates: tied.slice() },
      reasonZh: '请指定一名平局者退出船长争夺',
    });
  }
}

function cleanupMutiny(
  state: GameState,
  revealCounts: boolean,
  newCaptain: number | null,
  success: boolean,
) {
  for (const s of mutinyContributors(state)) {
    const p = seatOf(state, s);
    const revealed = state.mutiny.submissions[s] ?? 0;
    if (revealed <= 0) continue;
    if (!success) {
      p.guns += revealed; // 失败：全部收回
      continue;
    }
    let keep = 0;
    if (s === state.mutiny.peacemakerTarget) keep = revealed;
    if (state.gunsmithActive.includes(s)) keep += 1;
    if (
      newCaptain !== null &&
      s !== newCaptain &&
      p.characterId === 'chr_master_strategist' &&
      p.characterRevealed
    ) {
      keep = revealed;
    }
    const discard = Math.max(0, revealed - keep);
    p.guns += keep;
    state.gunSupply += discard;
  }
  state.mutiny = freshMutiny(0);
}

function finishMutiny(state: GameState, newCaptain: number) {
  const old = state.captain;
  state.captain = newCaptain;
  state.lieutenant = -1;
  state.navigator = -1;
  pushLog(state, `${nameOf(state, newCaptain)} 成为新船长（原船长 ${nameOf(state, old)}）。`);
  endRound(state);
}

function endRound(state: GameState) {
  state.round += 1;
  state.playedCardThisRound = null;
  state.yellowPlayedThisRound = false;
  state.stage = 'roundStart';
}

// ============ 航海 ============

function startNavigation(state: GameState, rng: Rng, emergency: boolean) {
  state.navigation = {
    stage: 'none',
    emergency,
    captainCards: [],
    lieutenantCards: [],
    captainDiscarded: [],
    lieutenantDiscarded: [],
    archivistSeat: null,
    smugglerSeat: null,
    logbook: [],
  };
  state.stage = 'draw';
}

function doDraw(state: GameState, rng: Rng) {
  if (state.navDeck.length < 4) reshuffleDeck(state, rng);
  const nav = state.navigation;
  const capCount = nav.smugglerSeat === state.captain ? 3 : 2;
  nav.captainCards = drawCards(state, rng, capCount);
  if (lieutenantValid(state)) {
    const ltCount = nav.smugglerSeat === state.lieutenant ? 3 : 2;
    nav.lieutenantCards = drawCards(state, rng, ltCount);
  } else {
    nav.lieutenantCards = [];
  }
  pushLog(state, `航海组 face-down 抽取了导航牌${nav.emergency ? '（紧急航海）' : ''}。`);
  state.stage = 'navCaptainDiscard';
}

function reshuffleDeck(state: GameState, rng: Rng) {
  if (state.navDiscard.length === 0) return;
  const combined = state.navDeck.concat(state.navDiscard);
  state.navDeck = [];
  state.navDiscard = [];
  rng.shuffle(combined);
  state.navDeck = combined;
  pushLog(state, '抽牌堆不足，弃牌堆合并且洗混（牌面朝下，不检查）。');
}

function drawCards(state: GameState, rng: Rng, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (state.navDeck.length === 0) reshuffleDeck(state, rng);
    if (state.navDeck.length === 0) break;
    out.push(state.navDeck.shift()!);
  }
  return out;
}

function handleChooseCard(state: GameState, rng: Rng, pending: PendingChoice, seatId: number, cmd: Command) {
  if (pending.data.archivistRedraw && cmd.type === 'pass') {
    // 档案员效果：选择保留，不重抽
    state.pending.pop();
    const role = pending.data.role as 'captain' | 'lieutenant';
    state.stage = role === 'captain' ? 'navCaptainDiscard' : 'navLieutenantDiscard';
    return;
  }
  if (cmd.type !== 'chooseCard') throw badCmd();
  const cardId = cmd.cardId;
  if (pending.data.archivistRedraw) {
    const role = pending.data.role as 'captain' | 'lieutenant';
    const old = role === 'captain' ? state.navigation.captainCards : state.navigation.lieutenantCards;
    for (const c of old) {
      state.navDiscard.push(c);
      state.recentDiscards.push(c);
    }
    if (state.recentDiscards.length > 3) state.recentDiscards.splice(0, state.recentDiscards.length - 3);
    const fresh = drawCards(state, rng, 2);
    if (role === 'captain') state.navigation.captainCards = fresh;
    else state.navigation.lieutenantCards = fresh;
    state.pending.pop();
    pushLog(state, `档案员：${nameOf(state, seatId)} 弃掉抽到的导航牌并重抽了2张。`);
    state.stage = role === 'captain' ? 'navCaptainDiscard' : 'navLieutenantDiscard';
    return;
  }
  const stage = pending.data.stage as string;
  if (stage === 'captain') {
    if (!state.navigation.captainCards.includes(cardId)) throw new RuleError('BAD_CARD', '你不持有这张牌');
    state.navigation.captainDiscarded = [cardId];
    discardToSea(state, cardId);
    state.pending.pop();
    pushLog(state, '航海组成员各弃一张导航牌，其余洗混放入航海日志。');
    if (!lieutenantValid(state) || state.navigation.lieutenantCards.length === 0) {
      state.navigation.lieutenantDiscarded = [];
      state.stage = 'navNavigator';
    } else {
      state.stage = 'navLieutenantDiscard';
    }
    return;
  }
  if (stage === 'lieutenant') {
    if (!state.navigation.lieutenantCards.includes(cardId)) throw new RuleError('BAD_CARD', '你不持有这张牌');
    state.navigation.lieutenantDiscarded = [cardId];
    discardToSea(state, cardId);
    state.pending.pop();
    state.stage = 'navNavigator';
    return;
  }
  throw badCmd();
}

function discardToSea(state: GameState, cardId: string) {
  state.navDiscard.push(cardId);
  state.recentDiscards.push(cardId);
  if (state.recentDiscards.length > 3) state.recentDiscards.shift();
}

function prepareLogbook(state: GameState, rng: Rng) {
  const nav = state.navigation;
  let logbook = [
    ...nav.captainCards.filter((c) => !(nav.captainDiscarded || []).includes(c)),
    ...nav.lieutenantCards.filter((c) => !(nav.lieutenantDiscarded || []).includes(c)),
  ];
  // 少于3人规则：空缺职位随机解决
  if (logbook.length === 0) {
    logbook = drawCards(state, rng, 2);
    pushLog(state, '人手不足：两张导航牌被随机放入航海日志。');
  } else if (logbook.length === 1) {
    const extra = drawCards(state, rng, 1);
    logbook.push(...extra);
    pushLog(state, '人手不足：一张随机导航牌被补入航海日志。');
  }
  rng.shuffle(logbook);
  nav.logbook = logbook; // 正常2张；走私者使某成员抽3张时为3张（领航员弃至剩1）
  if (navigatorValid(state)) {
    pushLog(state, `航海日志（含${nav.logbook.length}张面朝下导航牌）已交给领航员 ${nameOf(state, state.navigator)}。`);
    pushPending(state, {
      kind: 'navigatorChoose',
      actorSeat: state.navigator!,
      data: { cards: nav.logbook.slice() },
      reasonZh: '领航员：秘密查看导航牌，弃掉一张（仍有剩余则继续弃，至剩1张被执行），或跳海拒令',
    });
  } else {
    const idx = rng.int(nav.logbook.length);
    const discarded = nav.logbook.splice(idx, 1)[0];
    discardToSea(state, discarded);
    pushLog(state, '无有效领航员：随机弃掉一张导航牌。');
    state.playedCardThisRound = nav.logbook[0];
    nav.logbook = [];
    state.stage = 'navCaptainReveal';
  }
}

function handleNavigatorCommand(state: GameState, rng: Rng, seatId: number, cmd: Command) {
  if (cmd.type === 'navigatorAction' && cmd.action === 'jumpShip') {
    const nav = state.navigation;
    for (const c of nav.logbook) discardToSea(state, c);
    nav.logbook = [];
    const p = seatOf(state, seatId);
    p.eliminated = true;
    p.eliminationReason = 'overboard';
    state.navigator = -1;
    state.pending.pop();
    pushLog(state, `${nameOf(state, seatId)} 拒绝执行命令，跳海出局！必须进行紧急航海。`);
    pushPending(state, {
      kind: 'emergencyNavigator',
      actorSeat: state.captain,
      data: {},
      reasonZh: '请指定紧急领航员（可指定停职玩家；副手不变；无忠诚质询）',
    });
    return;
  }
  let cardId: string;
  if (cmd.type === 'navigatorAction' && cmd.action === 'discard') cardId = cmd.cardId;
  else if (cmd.type === 'chooseCard') cardId = cmd.cardId;
  else throw badCmd();
  const nav = state.navigation;
  if (!nav.logbook.includes(cardId)) throw new RuleError('BAD_CARD', '航海日志中没有这张牌');
  nav.logbook.splice(nav.logbook.indexOf(cardId), 1);
  discardToSea(state, cardId);
  if (nav.logbook.length > 1) {
    // 走私者导致的3张日志：继续弃至剩1张
    state.pending[state.pending.length - 1].data.cards = nav.logbook.slice();
    pushLog(state, `领航员弃掉一张导航牌（日志中还剩 ${nav.logbook.length} 张）。`);
    return;
  }
  state.pending.pop();
  state.playedCardThisRound = nav.logbook[0];
  nav.logbook = [];
  pushLog(state, '领航员做出了抉择：船长即将揭示最终导航牌。');
  state.stage = 'navCaptainReveal';
}

// ============ 导航牌结算 ============

function resolveNavCard(state: GameState, rng: Rng) {
  const cardId = state.playedCardThisRound!;
  const card = NAV_CARD_MAP[cardId];
  if (!card) throw new Error(`未知导航牌: ${cardId}`);
  const cap = seatOf(state, state.captain);
  cap.resumeCount += 1;
  cap.resumes.push(cardId);
  pushLog(state, `船长揭示导航牌：「${cardNameZh(cardId)}」——船向${DIRECTION_ZH[card.direction]}航行。`);
  // I. 移动船只
  const hex = state.map.hexes[state.shipHex];
  const dest = hex.exits[card.direction];
  moveShip(state, dest, rng);
  if (state.result) return;
  // II. 地图行动
  const destHex = state.map.hexes[state.shipHex];
  if (destHex.action) {
    beginMapAction(state, destHex.action);
    return;
  }
  // III. 导航牌行动
  doCardAction(state, rng, cardId);
}

function moveShip(state: GameState, dest: string, rng: Rng) {
  if (dest.startsWith('victory_')) {
    const kind = dest.split('_')[1] as 'pirate' | 'sailor' | 'cult';
    const zh = { pirate: '绯红湾', sailor: '蓝湾', cult: '海妖之域' };
    const faction = kind === 'sailor' ? 'sailor' : kind === 'pirate' ? 'pirate' : 'cult';
    // 船先驶入线内（shipHex 置为 victory_*，渲染坐标见地图 victoryPoints），再立即终局
    state.prevShipHex = state.shipHex;
    state.shipHex = dest;
    pushLog(state, `船驶入了${zh[kind]}！`);
    endGame(
      state,
      faction,
      `船抵达${zh[kind]}——${faction === 'sailor' ? '忠诚水手' : faction === 'pirate' ? '海盗' : '邪教'}获胜！`,
    );
    return;
  }
  const from = state.map.hexes[state.shipHex];
  const to = state.map.hexes[dest];
  state.prevShipHex = state.shipHex;
  state.shipHex = dest;
  pushLog(state, `船移动到新海域。`);
  if (to.supply && !from.supply) {
    state.crossedSupplyLine = true;
    refillGuns(state);
  }
}

function refillGuns(state: GameState) {
  let refilled = 0;
  for (const p of alivePlayers(state)) {
    if (p.guns < 3) {
      const give = Math.min(3 - p.guns, state.gunSupply);
      p.guns += give;
      state.gunSupply -= give;
      refilled += give;
    }
  }
  pushLog(state, `船越过补给线！全员补枪至3把（共补充 ${refilled} 把）。`);
}

function beginMapAction(state: GameState, action: MapActionKind) {
  state.pendingMapAction = action;
  const reasons: Record<MapActionKind, string> = {
    cabinSearch: '舱室搜查：选择一名玩家，秘密查看其阵营',
    flogging: '鞭刑：选择一名玩家接受鞭刑（将公开一个其不属于的阵营）',
    offWithTongue: '割舌：选择一名玩家（其不能再成为船长）',
    feedTheKraken: '献祭海妖：选择一名玩家献祭（不能选自己！若为邪教主则邪教直接获胜）',
  };
  const targets = alivePlayers(state).filter((p) => p.seatId !== state.captain);
  if (targets.length === 0) {
    state.pendingMapAction = null;
    doCardAction(state, rng2(state), state.playedCardThisRound!);
    return;
  }
  pushPending(state, {
    kind: 'choosePlayer',
    actorSeat: state.captain,
    data: { filter: 'mapActionTarget', effect: action },
    reasonZh: reasons[action],
  });
}

function rng2(state: GameState): Rng {
  return SeededRng.fromState(state.seededRngState);
}

function continueAfterMapAction(state: GameState, rng: Rng) {
  state.pendingMapAction = null;
  doCardAction(state, rng, state.playedCardThisRound!);
}

function doCardAction(state: GameState, rng: Rng, cardId: string) {
  const card = NAV_CARD_MAP[cardId];
  state.yellowPlayedThisRound = card.direction === 'north';
  switch (card.type) {
    case 'drunk': {
      const newCap = pickFewestResume(state, false);
      if (newCap >= 0 && newCap !== state.captain) {
        state.captain = newCap;
        state.lieutenant = state.lieutenant; // 职位保留至本轮结束
        pushLog(state, `醉酒：现任船长失去职位，船长职移交给 ${describePlayer(state, newCap)}。`);
      } else {
        pushLog(state, '醉酒：没有合适的接任者，船长不变。');
      }
      afterCardAction(state, rng);
      break;
    }
    case 'mermaid':
      beginCaptainChoose(state, 'mermaid', '美人鱼：选择一名玩家查看最近三张弃牌');
      break;
    case 'telescope':
      beginCaptainChoose(state, 'telescope', '望远镜：选择一名玩家查看牌堆顶');
      break;
    case 'armed': {
      if (navigatorValid(state) && state.gunSupply > 0) {
        const nav = seatOf(state, state.navigator);
        nav.guns += 1;
        state.gunSupply -= 1;
        pushLog(state, '武装：领航员从供应区获得1把枪。');
      }
      afterCardAction(state, rng);
      break;
    }
    case 'disarmed': {
      if (navigatorValid(state)) {
        const nav = seatOf(state, state.navigator);
        if (nav.guns > 0) {
          nav.guns -= 1;
          state.gunSupply += 1;
          pushLog(state, '缴械：领航员交出1把枪。');
        }
      }
      afterCardAction(state, rng);
      break;
    }
    case 'cultUprising':
      state.cultRitual.pendingRitual =
        state.cultRitual.deckOrder[state.cultRitual.revealedCount] ?? null;
      pushLog(state, '邪教暴动！航海结束时将进行邪教仪式。');
      afterCardAction(state, rng);
      break;
    default:
      afterCardAction(state, rng);
  }
}

function beginCaptainChoose(state: GameState, effect: string, reasonZh: string) {
  const targets = alivePlayers(state).filter((p) => p.seatId !== state.captain);
  if (targets.length === 0) {
    afterCardAction(state, rng2(state));
    return;
  }
  pushPending(state, {
    kind: 'choosePlayer',
    actorSeat: state.captain,
    data: { filter: 'mapActionTarget', effect },
    reasonZh,
  });
}

function afterCardAction(state: GameState, rng: Rng) {
  if (state.yellowPlayedThisRound) {
    state.stage = 'yellowWindow';
    openWindow(state, rng, 'yellowRound');
    return;
  }
  if (state.cultRitual.pendingRitual) {
    executeRitual(state, rng);
    return;
  }
  state.stage = 'offDuty';
}

function executeRitual(state: GameState, rng: Rng) {
  const ritual = state.cultRitual.pendingRitual;
  if (!ritual) {
    state.stage = 'offDuty';
    return;
  }
  state.cultRitual.revealedCount += 1;
  state.cultRitual.pendingRitual = null;
  pushLog(state, `邪教仪式揭示：「${ritualNameZh(ritual)}」。`);
  if (ritual.startsWith('ritual_conversion')) {
    const leader = findCultLeader(state);
    if (leader < 0) {
      pushLog(state, '船上没有邪教主，仪式无效。');
      state.stage = 'offDuty';
      return;
    }
    if (!alivePlayers(state).some((p) => isConvertible(p))) {
      pushLog(state, '没有可皈依的玩家，仪式无效。');
      state.stage = 'offDuty';
      return;
    }
    pushPending(state, {
      kind: 'choosePlayer',
      actorSeat: leader,
      data: { filter: 'convertible', effect: 'conversionToCult' },
      reasonZh: '皈依邪教：秘密选择一名可皈依的玩家变为邪教徒',
    });
    return;
  }
  if (ritual === 'ritual_guns_stash') {
    const leader = findCultLeader(state);
    if (leader < 0 || state.gunSupply < 3) {
      pushLog(state, '邪教主不在船上或供应区枪不足，仪式无效。');
      state.stage = 'offDuty';
      return;
    }
    pushPending(state, {
      kind: 'gunsStash',
      actorSeat: leader,
      data: {},
      reasonZh: '邪教军火库：将3把枪秘密分配给任意玩家（可给自己，可集中给一人）',
    });
    return;
  }
  if (ritual === 'ritual_cult_cabin_search') {
    const leader = findCultLeader(state);
    if (leader < 0) {
      pushLog(state, '船上没有邪教主，仪式无效。');
      state.stage = 'offDuty';
      return;
    }
    const zh: Record<string, string> = { sailor: '水手', pirate: '海盗', cultLeader: '邪教主', cultist: '邪教徒' };
    for (const s of [state.captain, state.lieutenant, state.navigator]) {
      if (s < 0) continue;
      const p = seatOf(state, s);
      pushLog(state, `邪教舱搜：${p.name} 的阵营是「${p.faction ? zh[p.faction] : '未知'}」。`, leader);
    }
    pushLog(state, '邪教舱搜：邪教主秘密得知了航海组三人的阵营。');
    state.stage = 'offDuty';
    return;
  }
  state.stage = 'offDuty';
}

function findCultLeader(state: GameState): number {
  const p = state.players.find((p) => p.faction === 'cultLeader' && !p.eliminated);
  return p ? p.seatId : -1;
}

export function ritualNameZh(id: string): string {
  if (id.startsWith('ritual_conversion')) return '皈依邪教';
  if (id === 'ritual_guns_stash') return '邪教军火库';
  if (id === 'ritual_cult_cabin_search') return '邪教舱室搜查';
  return id;
}

export function cardNameZh(id: string): string {
  const c = NAV_CARD_MAP[id];
  if (!c) return id;
  return `${DIRECTION_ZH[c.direction]}·${NAV_TYPE_ZH[c.type]}`;
}

// pickFewestResume: drunk(含 chiefCook)。排除割舌者（不能成为船长）、出局者与现任船长。
function pickFewestResume(state: GameState, includeTongueRule: boolean): number {
  const candidates = clockwiseFrom(state, state.captain).filter(
    (p) => !p.eliminated && !p.noTongue && p.seatId !== state.captain,
  );
  if (candidates.length === 0) return -1;
  const min = Math.min(...candidates.map((p) => p.resumeCount));
  return candidates.find((p) => p.resumeCount === min)!.seatId;
}

function applyOffDuty(state: GameState) {
  for (const p of state.players) p.offDuty = false;
  const signHolders: number[] = [];
  const n = state.playerCount;
  signHolders.push(state.captain);
  if (n >= 7) signHolders.push(state.lieutenant);
  if (n >= 9) signHolders.push(state.navigator);
  const names: string[] = [];
  for (const s of signHolders) {
    if (s >= 0 && !seatOf(state, s).eliminated) {
      seatOf(state, s).offDuty = true;
      names.push(nameOf(state, s));
    }
  }
  pushLog(
    state,
    `本轮航海结束，停职：${names.length ? names.join('、') : '无人'}。现任船长将继续主持下一轮。`,
  );
  state.stage = 'roundEnd';
}

function nextRound(state: GameState) {
  state.round += 1;
  state.playedCardThisRound = null;
  state.yellowPlayedThisRound = false;
  // 新一轮任命前收回旧职位徽章（副手/领航员每轮由船长重新任命）
  state.lieutenant = -1;
  state.navigator = -1;
  state.stage = 'roundStart';
  pushLog(state, `—— 第 ${state.round} 轮 ——`);
}

// ============ 终局 ============

export function endGame(state: GameState, winner: 'sailor' | 'pirate' | 'cult', reasonZh: string) {
  const factions: Record<number, Faction> = {};
  for (const p of state.players) {
    if (p.faction) factions[p.seatId] = p.faction;
  }
  state.result = { winner, reasonZh, factions };
  state.stage = 'ended';
  state.pending.length = 0;
  state.activation = null;
  pushLog(state, `对局结束：${reasonZh}`);
}
