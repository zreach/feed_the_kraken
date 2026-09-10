import React, { useState } from 'react';
import type { Faction, PlayerView, ViewPlayer } from '@ftk/engine';
import { CHARACTER_MAP } from '@ftk/engine';
import { CardFace, CardZoom } from './cards';

type FactionMark = Faction | 'cult';
const FACTION_ZH: Record<FactionMark, string> = { sailor: '水手', pirate: '海盗', cult: '邪教', cultLeader: '邪教主', cultist: '邪教徒' };
const NOT_ZH: Record<string, string> = { sailor: '水手', pirate: '海盗', cult: '邪教', cultLeader: '邪教主', cultist: '邪教徒' };

const FactionCard: React.FC<{ faction: FactionMark | null; revealed: boolean }> = ({ faction, revealed }) => (
  <div className={`faction-flip ${revealed ? 'is-revealed' : ''}`}>
    <div className="faction-flip-inner">
      <div className="faction-card faction-back"><span>⚓</span><small>秘密阵营</small></div>
      <div className={`faction-card faction-front faction-${faction ?? 'unknown'}`}>
        <span>{faction === 'pirate' ? '☠' : faction === 'cult' || faction === 'cultLeader' || faction === 'cultist' ? '◉' : '⚓'}</span>
        <b>{faction ? FACTION_ZH[faction] : '未知'}</b>
      </div>
    </div>
  </div>
);

export const PlayersPanel: React.FC<{ view: PlayerView; roomId: string }> = ({ view, roomId }) => {
  // 自己的阵营卡默认翻开（新玩家常找不到阵营信息在哪）
  const [myFactionOpen, setMyFactionOpen] = useState(true);
  const [zoomCard, setZoomCard] = useState<string | null>(null);
  const [markingSeat, setMarkingSeat] = useState<number | null>(null);
  // 私人阵营标注：按 房间+本人座位 持久化到 localStorage，刷新后不丢
  const markKey = `ftk-marks:${roomId}:${view.you.seatId}`;
  const [marks, setMarks] = useState<Record<number, FactionMark | undefined>>(() => {
    try {
      return JSON.parse(localStorage.getItem(markKey) ?? '{}');
    } catch {
      return {};
    }
  });
  const setMark = (seatId: number, mark?: FactionMark) => {
    setMarks((current) => {
      const next = { ...current, [seatId]: mark };
      if (mark === undefined) delete next[seatId];
      try {
        localStorage.setItem(markKey, JSON.stringify(next));
      } catch { /* 存储不可用时标注仅本次会话有效 */ }
      return next;
    });
    setMarkingSeat(null);
  };
  return <div className="players" onClick={() => markingSeat !== null && setMarkingSeat(null)}>
    {view.players.map((p) => <PlayerCard
      key={p.seatId} p={p} view={view} myFactionOpen={myFactionOpen}
      onToggleFaction={() => setMyFactionOpen((v) => !v)} onZoom={setZoomCard}
      mark={marks[p.seatId]} marking={markingSeat === p.seatId}
      onOpenMark={(e) => { e.preventDefault(); e.stopPropagation(); if (p.seatId !== view.you.seatId) setMarkingSeat(p.seatId); }}
      onMark={(mark) => setMark(p.seatId, mark)}
    />)}
    {zoomCard && <CardZoom id={zoomCard} onClose={() => setZoomCard(null)} />}
  </div>;
};

interface PlayerCardProps {
  p: ViewPlayer; view: PlayerView; myFactionOpen: boolean;
  onToggleFaction: () => void; onZoom: (id: string) => void;
  mark?: FactionMark; marking: boolean;
  onOpenMark: (e: React.MouseEvent) => void; onMark: (mark?: FactionMark) => void;
}

const PlayerCard: React.FC<PlayerCardProps> = ({ p, view, myFactionOpen, onToggleFaction, onZoom, mark, marking, onOpenMark, onMark }) => {
  const isMe = p.seatId === view.you.seatId;
  const teammate = view.you.teammates.includes(p.seatId);
  const dead = p.eliminated;
  const endFaction = view.result?.factions[p.seatId] ?? null;
  const faction: FactionMark | null = endFaction ?? p.faction ?? mark ?? null;
  const factionRevealed = Boolean(endFaction || mark || (!isMe && p.faction)) || (isMe && myFactionOpen);
  const roleName = p.revealedCharacterId ? CHARACTER_MAP[p.revealedCharacterId]?.nameZh : null;
  return <article className={`pcard player-board-row ${dead ? 'dead' : ''} ${isMe ? 'me' : ''}`}>
    <div className="player-summary">
      <div className="prow"><span className="pname">{p.name}{isMe ? '（你）' : ''}</span><span className="badges">
        {p.isCaptain && <span className="badge cap">船长</span>}{p.isLieutenant && <span className="badge lt">副手</span>}{p.isNavigator && <span className="badge nav">领航员</span>}
        {p.offDuty && <span className="badge off">停职</span>}{p.noTongue && <span className="badge off">割舌</span>}{!p.connected && <span className="badge discon">离线</span>}
      </span></div>
      <div className="player-stats"><span>枪支 <b>{p.guns ?? '？'}</b></span><span>履历 <b>{p.resumeCount}</b></span>{teammate && <span className="badge mate">队友</span>}{dead && <span className="dead-tag">{p.eliminationReason === 'overboard' ? '跳海' : '献祭'}出局</span>}</div>
      {roleName && <button className="revealed-role-link" onClick={() => onZoom(p.revealedCharacterId!)}>已亮出角色：{roleName}</button>}
      {p.resumes.length > 0 && <div className="resume-track" aria-label={`${p.name} 的船长履历`}>
        {p.resumes.map((id, index) => <button className="resume-token" key={`${id}:${index}`} onClick={() => onZoom(id)} title="点击放大这张船长履历"><CardFace id={id} compact /></button>)}
      </div>}
      {p.notFactions.length > 0 && <div className="player-not-factions">{p.notFactions.map((f) => <span key={f} className="badge notf">非{NOT_ZH[f]}</span>)}</div>}
    </div>
    <div className="player-card-rail" aria-label={`${p.name} 的阵营牌区`}>
      <button className="rail-card faction-card-button" onClick={isMe && !endFaction ? onToggleFaction : undefined} onContextMenu={onOpenMark}
        title={isMe && !endFaction ? '点击翻看自己的秘密阵营牌' : '右键：私下标注你对该玩家阵营的判断'} aria-label={`${p.name} 的阵营牌`}>
        <FactionCard faction={faction} revealed={factionRevealed} />
      </button>
      {marking && <div className="faction-mark-menu" role="menu" onClick={(e) => e.stopPropagation()}>
        <b>标注 TA 的阵营（仅自己可见）</b>
        <button onClick={() => onMark('sailor')}>水手</button><button onClick={() => onMark('pirate')}>海盗</button>
        <button onClick={() => onMark('cult')}>邪教</button><button onClick={() => onMark(undefined)}>清除标注</button>
      </div>}
    </div>
  </article>;
};
