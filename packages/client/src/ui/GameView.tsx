import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { RoomFullView, SessionInfo } from '../api';
import { sendChat, sendCommand, sendLobby, getSocket } from '../api';
import { PlayersPanel } from './PlayersPanel';
import { ActionPanel, cardNameZh } from './ActionPanel';
import { destinationText } from './navcards';
import { ReplayView } from './ReplayView';
import { BOARD_SKINS, DEFAULT_SKIN_ID, SKIN_STORAGE_KEY, getSkin } from './boards/registry';
import {
  notifyMyTurn,
  loadNotifySettings,
  saveNotifySettings,
  requestDesktopPermission,
  NotifySettings,
} from '../notify';
import { useModalDismiss } from './useModalDismiss';
import { CHARACTER_MAP, CHARACTERS, NAV_CARD_MAP, RITUAL_DECK, RITUAL_ZH, getMap } from '@ftk/engine';
import type { PlayerView } from '@ftk/engine';
import type { Command } from '@ftk/engine';
import { CardFace, CardZoom, cardTitle, cardAssetUrl } from './cards';

const cardLabel = (id: string) => cardNameZh(id);

const fmtWait = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

// 观战 / 玩家视图分发（T5）
export const GameView: React.FC<{
  session: SessionInfo;
  full: RoomFullView;
  onLeave: () => void;
}> = (props) =>
  props.session.spectator || props.full.youAreSpectator ? (
    <SpectatorGameView {...props} />
  ) : (
    <PlayerGameView {...props} />
  );

const ProcessBar: React.FC<{ stage: string }> = ({ stage }) => {
  const steps = [
    { keys: ['roundStart', 'appoint', 'afterAppoint'], label: '角色窗口 · 任命前' },
    { keys: ['mutiny'], label: '忠诚质询 · 哗变' },
    { keys: ['preDraw', 'draw', 'navCaptain', 'navLieutenant', 'navNavigator', 'navCaptainReveal'], label: '航海组秘密决策' },
    { keys: ['resolveNavCard', 'yellowWindow', 'offDuty'], label: '移动船只并执行效果' },
    { keys: ['roundEnd', 'ended'], label: '停职 · 回合结束' },
  ];
  const active = steps.findIndex((step) => step.keys.some((key) => stage.includes(key)));
  return (
    <div className="process-bar" aria-label="游戏流程">
      {steps.map((step, i) => <div key={step.label} className={`process-step ${i === active ? 'active' : ''} ${i < active ? 'done' : ''}`}><span>{i + 1}</span>{step.label}</div>)}
    </div>
  );
};

const RoleModal: React.FC<{ view: PlayerView; onClose: () => void }> = ({ view, onClose }) => {
  const cid = view.you.characterId;
  if (!cid || !CHARACTER_MAP[cid]) return null;
  const def = CHARACTER_MAP[cid];
  return <div className="modal-mask" onClick={onClose}><div className="modal role-modal" onClick={(e) => e.stopPropagation()}><div className="modal-heading"><div><div className="modal-kicker">你的秘密身份</div><div className="modal-title">我的角色 · {def.nameZh}</div></div><button className="btn small" onClick={onClose}>关闭</button></div><img className="role-modal-card" src={cardAssetUrl(cid) ?? undefined} alt={def.nameZh} /><p className="role-modal-note">这张角色牌只对你可见；角色亮出后，其他玩家才能在玩家区看到正面。</p></div></div>;
};

const CardLibrary: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [preview, setPreview] = useState<string | null>(null);
  const [tab, setTab] = useState<'roles' | 'nav' | 'ritual'>('roles');
  const navCards = useMemo(() => {
    const seen = new Set<string>();
    return Object.keys(NAV_CARD_MAP).filter((id) => {
      const c = NAV_CARD_MAP[id]; const key = `${c.direction}:${c.type}`;
      if (seen.has(key)) return false; seen.add(key); return true;
    });
  }, []);
  const navCounts = useMemo(() => Object.values(NAV_CARD_MAP).reduce<Record<string, number>>((a, c) => { const k = `${c.direction}:${c.type}`; a[k] = (a[k] ?? 0) + 1; return a; }, {}), []);
  const ritualCards = useMemo(() => {
    const seen = new Set<string>();
    return RITUAL_DECK.filter((id) => {
      const key = RITUAL_ZH[id] ?? id;
      if (seen.has(key)) return false; seen.add(key); return true;
    });
  }, []);
  const ritualCounts = useMemo(() => RITUAL_DECK.reduce<Record<string, number>>((a, id) => { const k = RITUAL_ZH[id] ?? id; a[k] = (a[k] ?? 0) + 1; return a; }, {}), []);
  const previewTitle = preview ? (CHARACTER_MAP[preview]?.nameZh ?? (NAV_CARD_MAP[preview] ? cardLabel(preview) : RITUAL_ZH[preview] ?? preview)) : '';
  return <div className="modal-mask" onClick={onClose}><div className="modal library-modal" onClick={(e) => e.stopPropagation()}>
    <div className="modal-heading"><div><div className="modal-kicker">船上资料库 · 点击任意卡牌放大</div><div className="modal-title">全部卡牌</div></div><button className="btn small" onClick={onClose}>关闭</button></div>
    <div className="library-tabs" role="tablist">{[['roles','角色卡'],['nav','导航卡'],['ritual','邪教仪式卡']].map(([id,label]) => <button key={id} role="tab" aria-selected={tab === id} className={`btn ${tab === id ? 'sel' : ''}`} onClick={() => setTab(id as typeof tab)}>{label}</button>)}</div>
    {tab === 'roles' && <section><h3>角色卡 · {CHARACTERS.length} 张不同角色</h3><div className="card-gallery character-gallery">{CHARACTERS.map((c) => <button className="library-card-button" key={c.id} onClick={() => setPreview(c.id)}><CardFace id={c.id} compact /><b>{c.nameZh}</b></button>)}</div></section>}
    {tab === 'nav' && <section><h3>导航卡 · 每类显示一张</h3><div className="card-gallery">{navCards.map((id) => <button className="library-card-button" key={id} onClick={() => setPreview(id)}><CardFace id={id} compact /><b>{cardTitle(id)}</b></button>)}</div><div className="card-counts"><b>牌堆数量</b>{Object.entries(navCounts).map(([key,count]) => <span key={key}>{cardLabel(Object.keys(NAV_CARD_MAP).find((id) => `${NAV_CARD_MAP[id].direction}:${NAV_CARD_MAP[id].type}` === key)!)} × {count}</span>)}</div></section>}
    {tab === 'ritual' && <section><h3>邪教仪式卡 · 每类显示一张</h3><div className="card-gallery">{ritualCards.map((id) => <button className="library-card-button" key={id} onClick={() => setPreview(id)}><CardFace id={id} compact /><b>{ritualCounts[RITUAL_ZH[id] ?? id] > 1 ? `${RITUAL_ZH[id]}*${ritualCounts[RITUAL_ZH[id] ?? id]}` : RITUAL_ZH[id]}</b></button>)}</div><div className="card-counts"><b>仪式牌堆数量</b>{ritualCards.map((id) => <span key={id}>{RITUAL_ZH[id]} × {ritualCounts[RITUAL_ZH[id] ?? id]}</span>)}</div></section>}
    {preview && <CardZoom id={preview} onClose={() => setPreview(null)} />}
  </div></div>;
};

const RulesModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="modal-mask" onClick={onClose}>
    <div className="modal rules-modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-heading"><div><div className="modal-kicker">船长手册</div><div className="modal-title">游戏规则</div></div><button className="btn small" onClick={onClose}>关闭</button></div>
      <div className="rules-long">
        <section><h3>1. 目标与终局</h3><p>水手阵营将船驶入蓝湾；海盗阵营将船驶入绯红湾。邪教阵营通常需要先完成仪式，再把船驶入海妖之域。邪教主被献祭给海妖时，邪教立即获胜；跳海不会直接带来胜利。</p></section>
        <section><h3>2. 准备与阵营</h3><p>下表每一列都代表实际人数，不使用“3/2/1”缩写。5 人局按官方抽取方式产生配置 A（概率 3/5）或配置 B（概率 2/5）；只有 11 人局存在开局邪教徒。</p><div className="rules-table-wrap"><table className="rules-table"><thead><tr><th>玩家总数</th><th>水手</th><th>海盗</th><th>邪教主</th><th>初始邪教徒</th></tr></thead><tbody><tr><td>5 · 配置 A</td><td>3</td><td>1</td><td>1</td><td>0</td></tr><tr><td>5 · 配置 B</td><td>2</td><td>2</td><td>1</td><td>0</td></tr><tr><td>6</td><td>3</td><td>2</td><td>1</td><td>0</td></tr><tr><td>7</td><td>4</td><td>2</td><td>1</td><td>0</td></tr><tr><td>8</td><td>4</td><td>3</td><td>1</td><td>0</td></tr><tr><td>9</td><td>5</td><td>3</td><td>1</td><td>0</td></tr><tr><td>10</td><td>5</td><td>4</td><td>1</td><td>0</td></tr><tr><td>11</td><td>5</td><td>4</td><td>1</td><td>1</td></tr></tbody></table></div><p>每位玩家开局获得一张秘密阵营牌、一个秘密角色和 3 把枪。阵营牌决定最终与哪一方共同获胜；角色牌提供一次性或持续技能，两者不是同一张牌。船长角色牌开局公开后换抽新的角色。</p></section>
        <section><h3>3. 职位与回合顺序</h3><p>每轮由船长任命副手和领航员。角色窗口可能在任命前、任命后、抽牌前、枪揭示后或黄牌回合开启。任命完成后进行哗变；哗变通过后，船长与副手依次处理导航牌，领航员从航海日志中秘密选择最终执行牌，船只移动并结算地图行动，最后处理停职并进入下一轮。</p></section>
        <section><h3>4. 任命与哗变</h3><p>船长不能任命自己，停职玩家通常不能进入航海组；当前规则允许的特殊效果和紧急航海除外。所有仍在船上的玩家秘密选择本次亮出的枪数，达到人数对应阈值即成功哗变：7 人及以下需要 3 把，8—9 人需要 4 把，10—11 人需要 5 把。捣乱者、和平使者、大战略家、煽动者、均衡者等角色会在指定时机改变计算方式。</p></section>
        <section><h3>5. 哗变结果与停职</h3><p>成功哗变时，符合条件的最高枪数玩家成为新船长；平局按游戏流程继续指定。原船长交出职位，成功哗变使用的枪通常被弃置，角色效果可能改变个别玩家的枪支处理。失败时按当前停职数量执行停职结算，并进入下一轮任命流程。枪数揭示后，选择的个人数字不再是秘密。</p></section>
        <section><h3>6. 导航牌</h3><p>船长先抽两张并秘密弃掉一张；副手再抽两张并秘密弃掉一张。两张保留牌面朝下放入航海日志并洗混，之后交给领航员。领航员秘密查看并弃掉一张，把唯一剩余牌留在日志中交回船长。此时船只不会自动移动：必须由船长打开航海日志、向全员公开最终牌并执行。导航牌只在相应玩家点击当前行动按钮后弹出，不能固定展示在航海图下方。</p><ul><li>北方黄色：邪教暴动，揭示并执行一张邪教仪式。</li><li>东方蓝色：醉酒或缴械，按对应牌面和地图规则结算。</li><li>西方红色：醉酒、美人鱼、望远镜或武装，分别触发秘密查看、弃牌、枪支或相关特殊效果。</li></ul></section>
        <section><h3>7. 邪教仪式</h3><p>邪教暴动会揭示当前仪式牌。皈依仪式秘密吸收一名可皈依玩家；邪教军火库秘密分配 3 把枪；舱室搜查秘密查看当前航海组三人的阵营。仪式目标和结果只发送给需要知道的玩家，初始 11 人邪教徒不会自动知道邪教主。</p></section>
        <section><h3>8. 地图行动与特殊状态</h3><p>船只按最终导航牌的方向移动。抵达补给线后补给相关规则生效。美人鱼允许目标秘密查看最近弃牌并自行决定是否公开；望远镜允许查看牌堆顶并选择弃掉或放回；武装与缴械改变枪支。停职、割舌、鞭刑、跳海、献祭和紧急航海均会改变后续可操作玩家，界面会在执行危险操作前二次确认。</p></section>
        <section><h3>9. 角色技能与信息边界</h3><p>每个角色只能在其标注的时机发动，并受目标限制、枪支代价和“每轮一次”等条件约束。海盗互相认识；11 人模式的初始邪教徒保持未知，皈依后才获得对应秘密信息。角色牌、未公开阵营、私密枪数、导航手牌和仪式目标不得出现在其他玩家视图；公开亮出的角色、船长履历、枪数揭示和终局阵营才可全员查看。</p></section>
        <section><h3>10. 快速航程、长航程与常见错误</h3><p>快速航程使用缩短后的地图和牌堆，长航程使用完整地图和完整导航牌堆；牌堆数量由引擎配置决定。不要把船长或副手看到的所有牌误认为最终执行牌，也不要把领航员的秘密日志、未公开角色或仪式目标显示给旁观玩家。游戏结束后才公开全部阵营和终局原因。</p></section>
      </div>
    </div>
  </div>
);

const RoleIntro: React.FC<{ view: PlayerView; onDone: () => void }> = ({ view, onDone }) => {
  const [flipped, setFlipped] = useState(false);
  const cid = view.you.characterId;
  const def = cid ? CHARACTER_MAP[cid] : null;
  if (!def) return null;
  return <div className="role-intro-mask"><div className="role-intro"><div className="modal-kicker">新航程开始 · 私密角色</div><div className={`role-flip-card ${flipped ? 'is-flipped' : ''}`} onClick={() => setFlipped(true)}><div className="role-face role-back"><span>⚓</span><b>FEED THE KRAKEN</b><small>点击翻开角色牌</small></div><div className="role-face role-front"><img src={cardAssetUrl(cid!)!} alt={def.nameZh} /></div></div><button className="btn primary" onClick={flipped ? onDone : () => setFlipped(true)}>{flipped ? '收起并加入玩家区' : '翻开角色牌'}</button></div></div>;
};


// 自己的角色牌面板（常显，含技能说明）
const YourCharacter: React.FC<{ view: PlayerView; acting: boolean }> = ({ view, acting }) => {
  const cid = view.you.characterId;
  if (!cid) return null;
  const def = CHARACTER_MAP[cid];
  if (!def) return null;
  const face = cardAssetUrl(cid) ?? undefined;
  return (
    <div className={`panel char-panel ${view.you.characterRevealed ? 'revealed' : ''}`}>
      <div className="panel-title">
        {acting ? '🤖 代打角色的牌' : '🎭 你的角色牌'}
        {view.you.characterRevealed ? '（已亮出）' : '（背面）'}
      </div>
      <div className="char-body">
        <img className="char-face role-card-image" src={face} alt={def.nameZh} />
        <div className="char-info">
          <div className="char-name">{def.nameZh}</div>
          <div className="card-text">{def.textZh}</div>
        </div>
      </div>
    </div>
  );
};

const PlayerGameView: React.FC<{
  session: SessionInfo;
  full: RoomFullView;
  onLeave: () => void;
}> = ({ session, full, onLeave }) => {
  const view = full.game!;
  const [chatText, setChatText] = useState('');
  const [err, setErr] = useState('');
  const [library, setLibrary] = useState<'role' | 'rules' | 'cards' | null>(null);
  const [showRoleIntro, setShowRoleIntro] = useState(() => {
    try { return view.round === 1 && !sessionStorage.getItem(`ftk-role-intro-${session.roomId}`); } catch { return view.round === 1; }
  });
  const [actingSeat, setActingSeat] = useState<number | null>(null); // 代打的机器人座位
  const [showReplay, setShowReplay] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<NotifySettings>(() => loadNotifySettings());
  const logRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  // 盘面皮肤（热插拔）：选择持久化到 localStorage，切换即时生效
  const [skinId, setSkinId] = useState<string>(() => {
    try {
      return localStorage.getItem(SKIN_STORAGE_KEY) ?? DEFAULT_SKIN_ID;
    } catch {
      return DEFAULT_SKIN_ID;
    }
  });
  const skin = getSkin(skinId);
  const Board = skin.Component;
  const map = useMemo(() => getMap(view.mapId), [view.mapId]);
  const changeSkin = (id: string) => {
    setSkinId(id);
    try {
      localStorage.setItem(SKIN_STORAGE_KEY, id);
    } catch {
      /* 隐私模式等场景下忽略 */
    }
  };
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [full.log.length]);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [full.chat.length]);

  // ===== T3：轮到你强提醒（false → true 跳变时触发） =====
  const myTurn = useMemo(() => {
    if (view.result || view.you.eliminated) return false;
    if (view.pending.some((p) => p.mine)) return true;
    return !!view.activationWindowKind && !view.youPassedWindow;
  }, [view]);
  const prevTurn = useRef(myTurn);
  useEffect(() => {
    if (myTurn && !prevTurn.current) {
      const reason = view.pending.find((p) => p.mine)?.reasonZh ?? '角色窗口开启：你可以启动角色或通过';
      notifyMyTurn(reason, loadNotifySettings());
    }
    prevTurn.current = myTurn;
  }, [myTurn, view]);

  // ===== T2：等待计时（每秒刷新） =====
  const [now, setNow] = useState(Date.now());
  const hasWaiting = !!full.waiting;
  useEffect(() => {
    if (!hasWaiting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasWaiting]);
  const waitSecs = full.waiting ? Math.max(0, Math.floor((now - full.waiting.since) / 1000)) : 0;

  // T12：设置弹窗 Esc/焦点圈闭
  const settingsRef = useRef<HTMLDivElement>(null);
  useModalDismiss(settingsRef, showSettings, () => setShowSettings(false));

  const botViews = full.botViews ?? {};
  const botSeats = Object.keys(botViews)
    .map(Number)
    .sort((a, b) => a - b);
  const activeView = actingSeat !== null && botViews[actingSeat] ? botViews[actingSeat] : view;
  const systemGuidance = view.activationWindowKind
    ? '等待玩家选择是否亮出身份。不能在当前时机亮出身份的玩家将由系统自动跳过。'
    : view.waitingFor;

  const onCommand = async (c: Command) => {
    setErr('');
    await sendCommand(getSocket(session.roomId), c, actingSeat ?? undefined);
  };

  // ===== T4：再来一局 =====
  const doRematch = async () => {
    setErr('');
    try {
      await sendLobby(getSocket(session.roomId), { action: 'rematch' });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="game">
      <ProcessBar stage={view.stage} />
      <header className="topbar">
        <span className="title">⚓ 险恶疑航</span>
        <span className="room-id">房间 {session.roomId}</span>
        <span className="stage">
          第 {view.round} 轮 · {view.stageZh}
        </span>
        <span className={`waiting ${waitSecs > 120 ? 'long' : ''}`}>
          {view.waitingFor}
          {full.waiting && waitSecs >= 10 ? ` · 已等待 ${fmtWait(waitSecs)}` : ''}
        </span>
        <button
          className="btn small"
          title="回合提醒设置"
          onClick={() => {
            setSettings(loadNotifySettings());
            setShowSettings(true);
          }}
        >
          🔔
        </button>
        <button className="btn small" onClick={onLeave}>
          退出
        </button>
      </header>
      {err && <div className="err">⚠ {err}</div>}
      <div className="game-main">
        <div className="col left">
          <PlayersPanel view={view} roomId={session.roomId} />
          <div className="quick-actions">
            <button className="quick-action" onClick={() => setLibrary('role')}><span>🎭</span>我的角色</button>
            <button className="quick-action" onClick={() => setLibrary('rules')}><span>📖</span>游戏规则</button>
            <button className="quick-action" onClick={() => setLibrary('cards')}><span>🃏</span>全部卡牌</button>
          </div>
        </div>
        <div className="col mid">
          <div className="board-bar">
            <select
              className="skin-select"
              value={skinId}
              onChange={(e) => changeSkin(e.target.value)}
              title="切换盘面皮肤（即时生效）"
            >
              {BOARD_SKINS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameZh}
                </option>
              ))}
            </select>
            <Suspense fallback={<div className="panel board-loading">🗺️ 盘面加载中…</div>}>
              <Board view={view} map={map} />
            </Suspense>
          </div>
          <div className="deck-info">
            <span className="pill">🂠 抽牌堆 <b>{view.navDeckCount}</b></span>
            <span className="pill">🌊 弃牌堆 <b>{view.navDiscardCount}</b></span>
            {view.ritualsRevealed.length > 0 && <span className="pill">🔮 已揭示仪式：{view.ritualsRevealed.join('、')}</span>}
          </div>
          {botSeats.length > 0 && (
            <div className="bot-switch">
              <span className="hint">代打对象：</span>
              <button
                className={`btn small ${actingSeat === null ? 'sel' : ''}`}
                onClick={() => setActingSeat(null)}
              >
                自己
              </button>
              {botSeats.map((sid) => (
                <button
                  key={sid}
                  className={`btn small ${actingSeat === sid ? 'sel' : ''}`}
                  onClick={() => setActingSeat(sid)}
                >
                  {view.players.find((p) => p.seatId === sid)?.name ?? `P${sid + 1}`}
                  {botViews[sid].pending.some((p) => p.mine) ? ' ●' : ''}
                </button>
              ))}
            </div>
          )}
          <ActionPanel key={`${actingSeat ?? 'me'}-${activeView.stage}`} view={activeView} onCommand={onCommand} onError={setErr} />
          {view.result && (
            <div className="panel end-actions">
              {full.lobby?.youAreHost ? (
                <button className="btn primary" onClick={doRematch}>
                  🔄 再来一局
                </button>
              ) : (
                <span className="hint">等待房主开始下一局…</span>
              )}
              <button className="btn" onClick={() => setShowReplay(true)}>
                🎥 查看复盘
              </button>
              <button className="btn" onClick={onLeave}>
                🚪 退出房间
              </button>
            </div>
          )}
          {activeView.yourHand.length > 0 && (
            <div className="hand-strip">
              <span className="hint">
                {actingSeat !== null ? '该机器人' : '你'}的手牌（{activeView.yourHand.length} 张，保密）·
                保留的牌将被执行：
              </span>
              {activeView.yourHand.map((c) => (
                <span key={c} className="minicard">
                  {cardLabel(c)}
                  <small> {destinationText(activeView, c)}</small>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="col right">
          <div className="panel">
            <div className="panel-title">📜 航海日志</div>
            <div className="log" ref={logRef} role="log" aria-live="polite">
              {full.log.map((l) => (
                <div key={l.id} className="log-line">
                  {l.textZh}
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-title">💬 船员频道</div>
            <div className="log chat" ref={chatRef}>
              {full.chat.map((m) => (
                <div key={m.id} className="chat-line">
                  <b>{m.name}：</b>
                  {m.text}
                </div>
              ))}
              <div className="chat-line system-guidance" aria-live="polite">
                <b>系统：</b>{systemGuidance}
              </div>
            </div>
            <form
              className="chat-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!chatText.trim()) return;
                try {
                  await sendChat(getSocket(session.roomId), chatText.trim());
                  setChatText('');
                } catch (ex) {
                  setErr((ex as Error).message);
                }
              }}
            >
              <input value={chatText} onChange={(e) => setChatText(e.target.value)} maxLength={300} placeholder="与船员对话…" />
              <button className="btn small" type="submit">
                发送
              </button>
            </form>
          </div>
        </div>
      </div>
      {showReplay && <ReplayView roomId={session.roomId} onClose={() => setShowReplay(false)} />}
      {showSettings && (
        <div className="modal-mask" onClick={() => setShowSettings(false)}>
          <div
            ref={settingsRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="回合提醒设置"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title">🔔 回合提醒设置</div>
            <label className="field check">
              <input
                type="checkbox"
                checked={settings.sound}
                onChange={(e) => {
                  const s = { ...settings, sound: e.target.checked };
                  setSettings(s);
                  saveNotifySettings(s);
                }}
              />
              提示音（轮到你时响铃）
            </label>
            <label className="field check">
              <input
                type="checkbox"
                checked={settings.desktop}
                onChange={async (e) => {
                  let on = e.target.checked;
                  if (on) on = await requestDesktopPermission();
                  const s = { ...settings, desktop: on };
                  setSettings(s);
                  saveNotifySettings(s);
                }}
              />
              桌面通知（切到其他标签页时）
            </label>
            <div className="hint small">切到后台时还会有标题栏闪烁提醒；页面内始终有右下角弹卡。</div>
            <button className="btn small" onClick={() => setShowSettings(false)}>
              关闭
            </button>
          </div>
        </div>
      )}
      {library === 'role' && <RoleModal view={view} onClose={() => setLibrary(null)} />}
      {library === 'rules' && <RulesModal onClose={() => setLibrary(null)} />}
      {library === 'cards' && <CardLibrary onClose={() => setLibrary(null)} />}
      {showRoleIntro && view.you.characterId && <RoleIntro view={view} onDone={() => { setShowRoleIntro(false); try { sessionStorage.setItem(`ftk-role-intro-${session.roomId}`, '1'); } catch { /* private mode */ } }} />}
    </div>
  );
};

// ============ 观战视图（T5）：只读、仅公开信息 ============
const SpectatorGameView: React.FC<{
  session: SessionInfo;
  full: RoomFullView;
  onLeave: () => void;
}> = ({ session, full, onLeave }) => {
  const view = full.game;
  const logRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [full.log.length]);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [full.chat.length]);
  const map = useMemo(() => (view ? getMap(view.mapId) : null), [view?.mapId]);
  const skin = getSkin(DEFAULT_SKIN_ID);
  const Board = skin.Component;

  return (
    <div className="game spectator">
      <header className="topbar">
        <span className="title">⚓ 险恶疑航</span>
        <span className="room-id">房间 {session.roomId}</span>
        <span className="badge spec">👁 观战中</span>
        {view && (
          <span className="stage">
            第 {view.round} 轮 · {view.stageZh}
          </span>
        )}
        {view && <span className="waiting">{view.waitingFor}</span>}
        <button className="btn small" onClick={onLeave}>
          退出
        </button>
      </header>
      {!view || !map ? (
        <div className="lobby">
          <h1>👀 等待新对局开始…</h1>
          <p className="hint">该房间正在准备下一局。开始后你的观战画面会自动恢复。</p>
          <button className="btn" onClick={onLeave}>
            返回首页
          </button>
        </div>
      ) : (
        <div className="game-main">
          <div className="col left">
            <PlayersPanel view={view} roomId={session.roomId} />
          </div>
          <div className="col mid">
            <div className="board-bar">
              <Suspense fallback={<div className="panel board-loading">🗺️ 盘面加载中…</div>}>
                <Board view={view} map={map} />
              </Suspense>
            </div>
            <div className="deck-info">
              <span className="pill">🂠 抽牌堆 <b>{view.navDeckCount}</b></span>
              <span className="pill">🌊 弃牌堆 <b>{view.navDiscardCount}</b></span>
              {view.ritualsRevealed.length > 0 && <span className="pill">🔮 已揭示仪式：{view.ritualsRevealed.join('、')}</span>}
            </div>
            {full.spectators && full.spectators.length > 0 && (
              <div className="hint">
                👀 观战者（{full.spectators.length}）：{full.spectators.map((s) => s.name).join('、')}
              </div>
            )}
          </div>
          <div className="col right">
            <div className="panel">
              <div className="panel-title">📜 航海日志（公开）</div>
              <div className="log" ref={logRef} role="log" aria-live="polite">
                {full.log.map((l) => (
                  <div key={l.id} className="log-line">
                    {l.textZh}
                  </div>
                ))}
              </div>
            </div>
            <div className="panel">
              <div className="panel-title">💬 船员频道</div>
              <div className="log chat" ref={chatRef}>
                {full.chat.map((m) => (
                  <div key={m.id} className="chat-line">
                    <b>{m.name}：</b>
                    {m.text}
                  </div>
                ))}
              </div>
              <div className="hint">观战模式不可发言。</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

