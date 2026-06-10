const RANKS = [
  { id: 'king',     label: '👑 King of Badminton', min: 3000, class: 'rank-king'     },
  { id: 'master',   label: '🔥 Master Player',      min: 1500, class: 'rank-master'   },
  { id: 'diamond',  label: '💠 Diamond',             min: 801,  class: 'rank-diamond'  },
  { id: 'platinum', label: '💎 Platinum',            min: 501,  class: 'rank-platinum' },
  { id: 'gold',     label: '🥇 Gold',                min: 301,  class: 'rank-gold'     },
  { id: 'silver',   label: '🥈 Silver',              min: 101,  class: 'rank-silver'   },
  { id: 'bronze',   label: '🥉 Bronze',              min: 0,    class: 'rank-bronze'   },
];

function getRank(pts, playerId) {
  if (pts >= 3000) { const sorted = [...db.players].sort((a,b)=>b.pts-a.pts); if (sorted.length > 0 && sorted[0].id === playerId) return RANKS[0]; }
  for (let i = 1; i < RANKS.length; i++) { if (pts >= RANKS[i].min) return RANKS[i]; }
  return RANKS[RANKS.length - 1];
}
function getRankByPts(pts) { for (let i = 1; i < RANKS.length; i++) { if (pts >= RANKS[i].min) return RANKS[i]; } return RANKS[RANKS.length - 1]; }
function rankProgress(pts) {
  const ranksAsc = [...RANKS].slice(1).reverse(); // bronze → master
  for (let i = 0; i < ranksAsc.length - 1; i++) {
    const cur = ranksAsc[i], next = ranksAsc[i+1];
    if (pts >= cur.min && pts < next.min) return { pct: Math.round(((pts - cur.min) / (next.min - cur.min)) * 100), next };
  }
  // Master (1500+): progress toward King (3000); at 3000+ pts the bar is maxed
  if (pts >= 3000) return { pct: 100, next: null };
  return { pct: Math.max(0, Math.round(((pts - 1500) / (3000 - 1500)) * 100)), next: RANKS[0] };
}

function getKFactor(totalMatches) {
  if (totalMatches < 10) return 48;   // ผู้เล่นใหม่ – ขยับเร็ว
  if (totalMatches < 30) return 32;   // ระดับกลาง
  return 24;                          // ผู้เล่นเก่า – stable
}

const RANK_ELO_MULTIPLIERS = {
  bronze:   2.00,
  silver:   1.75,
  gold:     1.60,
  platinum: 1.50,
  diamond:  1.25,
  master:   1.15,
  king:     1.05,
};

function getRankEloMultiplier(pts) {
  const rank = getRankByPts(pts);
  return RANK_ELO_MULTIPLIERS[rank.id] ?? 1.0;
}

function getScoreMultiplier(scoreA, scoreB) {
  const diff = Math.abs(scoreA - scoreB);
  if (diff <= 3)  return 1.0;   // สูสี
  if (diff <= 7)  return 1.2;   // ห่างพอควร
  if (diff <= 12) return 1.5;   // ชนะค่อนข้างขาด
  if (diff <= 18) return 1.75;  // ชนะขาด
  return 2.0;                   // ชนะขาดลอย
}

function calcElo(winnerPts, loserPts, winnerTotal, loserTotal, scoreA, scoreB) {
  const Ew = 1 / (1 + Math.pow(10, (loserPts - winnerPts) / 400)); // โอกาสชนะที่คาดไว้ของผู้ชนะ
  const El = 1 - Ew;                                                 // โอกาสชนะที่คาดไว้ของผู้แพ้
  const mult = getScoreMultiplier(scoreA, scoreB);
  const rankMult = getRankEloMultiplier(winnerPts);                  // ตัวคูณตามอันดับของผู้ชนะ
  const Kw = getKFactor(winnerTotal);
  const Kl = getKFactor(loserTotal);
  const gain = Math.max(4, Math.round(Kw * (1 - Ew) * mult * rankMult));  // ผู้ชนะได้อย่างน้อย 4 คะแนน
  const loss = Math.max(4, Math.round(Kl * El       * mult));              // ผู้แพ้เสียไม่มีตัวคูณ rank
  return { gain, loss };
}

function calcEloTeam(winners, losers, scoreW, scoreL) {
  const avgW = Math.round(winners.reduce((s,p)=>s+p.pts,0) / winners.length);
  const avgL = Math.round(losers.reduce((s,p)=>s+p.pts,0) / losers.length);
  const avgTotalW = Math.round(winners.reduce((s,p)=>s+(p.wins+p.losses),0) / winners.length);
  const avgTotalL = Math.round(losers.reduce((s,p)=>s+(p.wins+p.losses),0) / losers.length);
  const { gain, loss } = calcElo(avgW, avgL, avgTotalW, avgTotalL, scoreW, scoreL);
  return { perWinner: gain, perLoser: loss };
}

function getAchBoostMult(player) {
  let boost = 0;
  for (const a of (player?.customAch || [])) {
    if (a.frame === 'gold') boost += 0.15;
    else if (a.frame === 'silver') boost += 0.10;
    else if (a.frame === 'bronze') boost += 0.05;
  }
  return 1 + boost;
}
function applyAchBoost(baseGain, player) {
  return Math.max(baseGain, Math.round(baseGain * getAchBoostMult(player)));
}
function achBoostLabel(player) {
  const mult = getAchBoostMult(player);
  if (mult <= 1) return '';
  return ` 🚀+${Math.round((mult-1)*100)}%`;
}

