import { useState, useEffect, useRef } from "react";

const ANIMALS = {
  bear:  { emoji: "🐻", tier: "common",   name: "หมีกริซลี่",     bg: ["#4a3728","#2d1f14"], border: "#6b4c35" },
  snake: { emoji: "🐍", tier: "uncommon", name: "งูเห่าราชา",    bg: ["#1a3a1a","#0d2010"], border: "#2d6b2d" },
  shark: { emoji: "🦈", tier: "uncommon", name: "ฉลามขาวยักษ์",  bg: ["#0d2233","#071520"], border: "#1a5580" },
  fox:   { emoji: "🦊", tier: "epic",     name: "จิ้งจอกแดง",    bg: ["#3d1f00","#1f0f00"], border: "#c05a00" },
  eagle: { emoji: "🦅", tier: "epic",     name: "อินทรีหัวขาว",  bg: ["#1a1200","#0d0a00"], border: "#c8900a" },
  tiger: { emoji: "🐯", tier: "mythic",   name: "เสือเบงกอล",    bg: ["#2d1400","#1a0a00"], border: "#9333ea" },
  lion:  { emoji: "🦁", tier: "mythic",   name: "ราชสีห์",       bg: ["#2d1800","#1a0e00"], border: "#9333ea" },
  wolf:  { emoji: "🐺", tier: "secret",   name: "หมาป่าเดียวดาย",bg: ["#071428","#040c1c"], border: "#bae6fd" },
};

const TIERS = {
  common:   { label: "Common",   color: "#9ca3af", pct: "70%",   glow: null },
  uncommon: { label: "Uncommon", color: "#34d399", pct: "23.9%", glow: null },
  epic:     { label: "Epic",     color: "#f59e0b", pct: "5%",    glow: "#f59e0b" },
  mythic:   { label: "Mythic",   color: "#a855f7", pct: "1%",    glow: "#a855f7" },
  secret:   { label: "Secret",   color: "#e2e8f0", pct: "0.1%",  glow: "#bae6fd" },
};

const TIER_RANK = { secret: 0, mythic: 1, epic: 2, uncommon: 3, common: 4 };

function SnowCanvas({ width, height, count = 40 }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const flakes = Array.from({ length: count }, () => ({
      x: Math.random() * width, y: Math.random() * height,
      r: Math.random() * 2.5 + 0.5, speed: Math.random() * 0.7 + 0.2,
      drift: (Math.random() - 0.5) * 0.4, opacity: Math.random() * 0.7 + 0.3,
      wobble: Math.random() * Math.PI * 2,
    }));
    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const t = Date.now() / 1200;
      flakes.forEach(f => {
        const op = f.opacity * (0.7 + 0.3 * Math.sin(t + f.wobble));
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${op})`; ctx.fill();
        f.y += f.speed; f.x += f.drift + Math.sin(t + f.wobble) * 0.3;
        if (f.y > height) { f.y = -5; f.x = Math.random() * width; }
        if (f.x > width) f.x = 0; if (f.x < 0) f.x = width;
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [width, height, count]);
  return (
    <canvas ref={ref} width={width} height={height}
      style={{ position: "absolute", inset: 0, borderRadius: "50%", pointerEvents: "none", zIndex: 10 }} />
  );
}

function GlowRing({ color, tier }) {
  return (
    <>
      <style>{`
        @keyframes secretPulse { 0%,100%{box-shadow:0 0 0 3px ${color}99,0 0 20px 6px ${color}55,0 0 40px 10px ${color}22} 50%{box-shadow:0 0 0 4px ${color}ff,0 0 28px 10px ${color}88,0 0 55px 16px ${color}44} }
        @keyframes mythicPulse { 0%,100%{box-shadow:0 0 0 3px ${color}aa,0 0 18px 5px ${color}55} 50%{box-shadow:0 0 0 4px ${color}ff,0 0 26px 8px ${color}88} }
        @keyframes epicPulse   { 0%,100%{box-shadow:0 0 0 2px ${color}88,0 0 12px 4px ${color}44} 50%{box-shadow:0 0 0 3px ${color}cc,0 0 20px 6px ${color}66} }
        @keyframes rotateBorder { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes rotateBorderRev { from{transform:rotate(360deg)} to{transform:rotate(0deg)} }
      `}</style>
      <div style={{ position:"absolute", inset:-4, borderRadius:"50%",
        animation: tier==="secret"?"secretPulse 2.5s ease-in-out infinite":tier==="mythic"?"mythicPulse 1.8s ease-in-out infinite":"epicPulse 2.8s ease-in-out infinite",
        zIndex:0 }}/>
      {(tier==="mythic"||tier==="secret") && (
        <div style={{ position:"absolute", inset:-8, borderRadius:"50%",
          border:`2px dashed ${color}66`, animation:"rotateBorder 8s linear infinite", zIndex:0 }}/>
      )}
      {tier==="secret" && (
        <div style={{ position:"absolute", inset:-14, borderRadius:"50%",
          border:`1.5px dashed ${color}33`, animation:"rotateBorderRev 12s linear infinite", zIndex:0 }}/>
      )}
    </>
  );
}

function AnimalCard({ animal, size=110, showBite=false }) {
  const info = ANIMALS[animal];
  const tier = TIERS[info.tier];
  const isAnimated = info.tier==="epic"||info.tier==="mythic"||info.tier==="secret";
  const emojiSize = Math.round(size * 0.52);

  return (
    <div style={{ position:"relative", width:size, height:size }}>
      <style>{`
        @keyframes animalFloat { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-5px) scale(1.04)} }
        @keyframes animalBite  { 0%,100%{transform:translateY(0) scale(1)} 40%{transform:translateY(-8px) scale(1.12)} 60%{transform:translateY(3px) scale(0.96)} }
        @keyframes shimmerBG   { 0%,100%{opacity:1} 50%{opacity:0.6} }
      `}</style>

      {/* BG circle */}
      <div style={{
        position:"absolute", inset:0, borderRadius:"50%",
        background:`radial-gradient(circle at 40% 35%, ${info.bg[0]}, ${info.bg[1]})`,
        border:`3px solid ${info.border}`,
        overflow:"hidden", zIndex:1,
      }}>
        {/* Inner glow spot */}
        <div style={{
          position:"absolute", inset:0,
          background:`radial-gradient(circle at 50% 40%, ${info.border}33, transparent 65%)`,
          animation: isAnimated?"shimmerBG 2.5s ease-in-out infinite":"none",
        }}/>

        {/* Emoji */}
        <div style={{
          position:"absolute", inset:0,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:emojiSize, lineHeight:1, userSelect:"none",
          animation: showBite
            ? "animalBite 0.5s ease-in-out"
            : isAnimated ? "animalFloat 2.2s ease-in-out infinite" : "none",
          filter: showBite ? `drop-shadow(0 4px 16px ${info.border})` : undefined,
          zIndex:2,
        }}>
          {info.emoji}
        </div>

        {/* Snow for secret */}
        {info.tier==="secret" && <SnowCanvas width={size} height={size} count={35}/>}
      </div>

      {/* Glow ring */}
      {tier.glow && <GlowRing color={tier.glow} tier={info.tier}/>}
    </div>
  );
}

function ProfileFrame({ animal, size=110 }) {
  const info = ANIMALS[animal];
  const tier = TIERS[info.tier];
  const [biting, setBiting] = useState(false);
  const isMythicPlus = info.tier==="mythic"||info.tier==="secret";

  useEffect(() => {
    if (!isMythicPlus) return;
    const offset = Math.random() * 2000;
    let interval;
    const t = setTimeout(() => {
      interval = setInterval(() => {
        setBiting(true);
        setTimeout(() => setBiting(false), 600);
      }, 5000);
    }, offset);
    return () => { clearTimeout(t); clearInterval(interval); };
  }, [isMythicPlus]);

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
      <AnimalCard animal={animal} size={size} showBite={biting}/>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:"0.58rem", fontWeight:900, color:tier.color,
          textTransform:"uppercase", letterSpacing:"0.14em",
          textShadow: tier.glow?`0 0 8px ${tier.color}`:undefined }}>
          {tier.label} · {tier.pct}
        </div>
        <div style={{ fontSize:"0.75rem", color:"#94a3b8", marginTop:3 }}>{info.name}</div>
      </div>
    </div>
  );
}

function SecretName({ name }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W=canvas.width, H=canvas.height;
    const flakes = Array.from({length:18},()=>({
      x:Math.random()*W, y:Math.random()*H,
      r:Math.random()*1.5+0.3, speed:Math.random()*0.4+0.15,
      drift:(Math.random()-0.5)*0.3, opacity:Math.random()*0.8+0.2,
    }));
    let raf;
    const draw=()=>{
      ctx.clearRect(0,0,W,H);
      flakes.forEach(f=>{
        ctx.beginPath(); ctx.arc(f.x,f.y,f.r,0,Math.PI*2);
        ctx.fillStyle=`rgba(255,255,255,${f.opacity})`; ctx.fill();
        f.y+=f.speed; f.x+=f.drift;
        if(f.y>H){f.y=-4;f.x=Math.random()*W;}
        if(f.x>W)f.x=0; if(f.x<0)f.x=W;
      });
      raf=requestAnimationFrame(draw);
    };
    draw();
    return ()=>cancelAnimationFrame(raf);
  }, []);
  return (
    <div style={{ position:"relative", display:"inline-block" }}>
      <style>{`@keyframes snowShimmer{0%{background-position:0% 50%}100%{background-position:300% 50%}}`}</style>
      <span style={{
        background:"linear-gradient(90deg,#fff,#94a3b8,#bae6fd,#e2e8f0,#fff,#bae6fd,#fff)",
        backgroundSize:"300% auto", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
        animation:"snowShimmer 4s linear infinite",
        fontWeight:800, fontSize:"0.9rem", letterSpacing:"0.06em",
      }}>{name}</span>
      <canvas ref={ref} width={140} height={24}
        style={{ position:"absolute", top:-2, left:-5, pointerEvents:"none" }}/>
    </div>
  );
}

function LeaderRow({ rank, name, animal, elo }) {
  const info = ANIMALS[animal];
  const tier = TIERS[info.tier];
  const [biting, setBiting] = useState(false);
  const isMythicPlus = info.tier==="mythic"||info.tier==="secret";

  useEffect(() => {
    if (!isMythicPlus) return;
    let interval;
    const t = setTimeout(() => {
      interval = setInterval(() => {
        setBiting(true);
        setTimeout(() => setBiting(false), 600);
      }, 5000);
    }, rank * 700);
    return () => { clearTimeout(t); clearInterval(interval); };
  }, [isMythicPlus, rank]);

  return (
    <div style={{
      display:"flex", alignItems:"center", gap:12,
      padding:"10px 16px", borderRadius:14,
      background: info.tier==="secret"
        ? "linear-gradient(90deg,#04080f,#071428,#04080f)"
        : info.tier==="mythic" ? "linear-gradient(90deg,#10061e,#180830,#10061e)" : "#111827",
      border:`1.5px solid ${tier.color}44`,
      boxShadow: tier.glow ? `0 0 16px ${tier.glow}22, inset 0 0 20px ${tier.glow}08` : "none",
    }}>
      <div style={{ width:28, textAlign:"center", fontSize:"0.85rem", fontWeight:800,
        color: rank<=3?["#ffd700","#c0c0c0","#cd7f32"][rank-1]:"#475569" }}>
        {rank<=3?["🥇","🥈","🥉"][rank-1]:`#${rank}`}
      </div>
      <div style={{ flexShrink:0 }}>
        <AnimalCard animal={animal} size={48} showBite={biting}/>
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        {info.tier==="secret"
          ? <SecretName name={name}/>
          : <div style={{ fontWeight:700, fontSize:"0.9rem",
              color: info.tier==="mythic"?"#e879f9":"#e2e8f0",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</div>
        }
        <div style={{ fontSize:"0.6rem", color:tier.color, marginTop:2,
          textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:700,
          textShadow: tier.glow?`0 0 6px ${tier.color}`:undefined }}>
          {tier.label} · {info.name}
        </div>
      </div>
      <div style={{ fontWeight:800, fontSize:"0.9rem", color:"#94a3b8", flexShrink:0 }}>
        {elo.toLocaleString()}
      </div>
    </div>
  );
}

// ── Gacha System ──────────────────────────────────────────────────────────────

function rollAnimal() {
  const r = Math.random() * 100;
  if (r < 0.1)  return "wolf";
  if (r < 1.1)  return Math.random() < 0.5 ? "tiger" : "lion";
  if (r < 6.1)  return Math.random() < 0.5 ? "fox"   : "eagle";
  if (r < 30)   return Math.random() < 0.5 ? "snake" : "shark";
  return "bear";
}

function getRarestIndex(animals) {
  let best = 0;
  animals.forEach((a, i) => {
    if (TIER_RANK[ANIMALS[a].tier] < TIER_RANK[ANIMALS[animals[best]].tier]) best = i;
  });
  return best;
}

function SingleReveal({ animal }) {
  const info = ANIMALS[animal];
  const tier = TIERS[info.tier];
  const isDramatic = info.tier === "secret" || info.tier === "mythic";
  return (
    <div style={{
      marginTop: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
      animation: isDramatic
        ? "wf_dramaticIn 0.9s cubic-bezier(0.175,0.885,0.32,1.275) forwards"
        : "wf_revealPop 0.55s cubic-bezier(0.175,0.885,0.32,1.275) forwards",
    }}>
      {isDramatic && (
        <div style={{
          position: "absolute", width: 200, height: 200, borderRadius: "50%",
          background: `radial-gradient(circle, ${tier.glow}44 0%, transparent 70%)`,
          animation: "wf_dramaticHalo 1.2s ease-out forwards",
          pointerEvents: "none",
        }}/>
      )}
      <div style={{ filter: tier.glow ? `drop-shadow(0 0 32px ${tier.glow})` : undefined, position: "relative", zIndex: 1 }}>
        <AnimalCard animal={animal} size={130}/>
      </div>
      <div style={{ animation: "wf_tierTextIn 0.4s 0.35s ease-out both", textAlign: "center" }}>
        <div style={{
          fontSize: isDramatic ? "1.5rem" : "1.3rem", fontWeight: 900, color: tier.color,
          textShadow: tier.glow ? `0 0 20px ${tier.color}, 0 0 40px ${tier.color}88` : undefined,
          textTransform: "uppercase", letterSpacing: "0.1em",
        }}>
          {isDramatic ? "✨✨" : "✨"} {tier.label}! {isDramatic ? "✨✨" : "✨"}
        </div>
        <div style={{ fontSize: "0.88rem", color: "#94a3b8", marginTop: 6 }}>
          {info.name} · โอกาส {tier.pct}
        </div>
      </div>
    </div>
  );
}

function TenReveal({ animals }) {
  const rarestIdx = getRarestIndex(animals);
  const rarestAnimal = animals[rarestIdx];
  const rarestInfo  = ANIMALS[rarestAnimal];
  const rarestTier  = TIERS[rarestInfo.tier];

  return (
    <div style={{ marginTop: 20 }}>
      {/* Rarest banner */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        marginBottom: 16, padding: "7px 18px", borderRadius: 40,
        background: `${rarestTier.color}18`,
        border: `1.5px solid ${rarestTier.color}55`,
        animation: "wf_tierTextIn 0.4s 0.1s ease-out both",
      }}>
        <span style={{ fontSize: "0.95rem" }}>{rarestInfo.emoji}</span>
        <span style={{
          fontSize: "0.68rem", fontWeight: 800, color: rarestTier.color,
          textTransform: "uppercase", letterSpacing: "0.1em",
          textShadow: rarestTier.glow ? `0 0 8px ${rarestTier.color}` : undefined,
        }}>
          🌟 ดีที่สุด: {rarestInfo.name} · {rarestTier.label}
        </span>
      </div>

      {/* 5×2 grid */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
        gap: 10, maxWidth: 460, margin: "0 auto",
      }}>
        {animals.map((animal, i) => {
          const info = ANIMALS[animal];
          const tier = TIERS[info.tier];
          const isRarest  = i === rarestIdx;
          const isDramatic = info.tier === "secret" || info.tier === "mythic";
          const delay = `${i * 0.065}s`;

          return (
            <div key={i} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
              position: "relative",
              animation: isDramatic
                ? `wf_dramaticIn 0.65s ${delay} cubic-bezier(0.175,0.885,0.32,1.275) both`
                : `wf_cardStagger 0.45s ${delay} cubic-bezier(0.175,0.885,0.32,1.275) both`,
            }}>
              {/* Rarest highlight ring */}
              {isRarest && (
                <>
                  <div style={{
                    position: "absolute", top: 0, width: 80, height: 80,
                    borderRadius: "50%", border: `2.5px solid ${rarestTier.color}`,
                    animation: "wf_rarestRing 1.6s ease-out infinite",
                    pointerEvents: "none", zIndex: 5,
                  }}/>
                  <div style={{
                    position: "absolute", top: -18, left: "50%", transform: "translateX(-50%)",
                    fontSize: "0.52rem", fontWeight: 900, color: rarestTier.color,
                    textTransform: "uppercase", letterSpacing: "0.08em",
                    whiteSpace: "nowrap", zIndex: 6,
                    textShadow: `0 0 8px ${rarestTier.color}`,
                  }}>★ BEST</div>
                </>
              )}

              <div style={{
                filter: tier.glow ? `drop-shadow(0 0 14px ${tier.glow})` : undefined,
                animation: isRarest ? "wf_rarestPulse 2s ease-in-out infinite" : undefined,
              }}>
                <AnimalCard animal={animal} size={76}/>
              </div>

              <div style={{
                fontSize: "0.48rem", fontWeight: 800, color: tier.color,
                textTransform: "uppercase", letterSpacing: "0.08em",
                textShadow: tier.glow ? `0 0 5px ${tier.color}` : undefined,
              }}>
                {tier.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GachaSystem() {
  const [coins,    setCoins]    = useState(100);
  const [pulling,  setPulling]  = useState(false);
  const [flash,    setFlash]    = useState(false);
  const [results,  setResults]  = useState([]);
  const [isTen,    setIsTen]    = useState(false);

  const doPull = (count) => {
    if (pulling) return;
    const cost = count * 5;
    if (coins < cost) return;

    setPulling(true);
    setResults([]);
    setIsTen(count === 10);
    setCoins(c => c - cost);

    const pulled = Array.from({ length: count }, rollAnimal);

    setTimeout(() => {
      setFlash(true);
      setTimeout(() => {
        setFlash(false);
        setResults(pulled);
        setPulling(false);
      }, 380);
    }, 750);
  };

  const canX1  = !pulling && coins >= 5;
  const canX10 = !pulling && coins >= 50;

  return (
    <div style={{ textAlign: "center" }}>
      <style>{`
        @keyframes wf_flashIn      { 0%{opacity:0} 45%{opacity:1} 100%{opacity:0} }
        @keyframes wf_revealPop    { 0%{transform:scale(0.3) rotate(-10deg);opacity:0} 60%{transform:scale(1.15) rotate(2deg)} 100%{transform:scale(1) rotate(0);opacity:1} }
        @keyframes wf_dramaticIn   { 0%{opacity:0;transform:scale(0.1) rotate(-20deg)} 55%{transform:scale(1.28) rotate(4deg)} 78%{transform:scale(0.94) rotate(-1deg)} 100%{opacity:1;transform:scale(1) rotate(0)} }
        @keyframes wf_dramaticHalo { 0%{transform:scale(0.4);opacity:1} 100%{transform:scale(2.2);opacity:0} }
        @keyframes wf_cardStagger  { 0%{opacity:0;transform:scale(0.4) translateY(18px)} 65%{transform:scale(1.1) translateY(-3px)} 100%{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes wf_tierTextIn   { 0%{opacity:0;transform:translateY(10px)} 100%{opacity:1;transform:translateY(0)} }
        @keyframes wf_rarestPulse  { 0%,100%{filter:brightness(1)} 50%{filter:brightness(1.45)} }
        @keyframes wf_rarestRing   { 0%{transform:scale(1.0);opacity:0.9} 100%{transform:scale(1.7);opacity:0} }
        @keyframes wf_coinPop      { 0%{transform:scale(1)} 40%{transform:scale(1.25)} 100%{transform:scale(1)} }
        @keyframes wf_btnPulse     { 0%,100%{box-shadow:0 0 20px #a855f766} 50%{box-shadow:0 0 32px #a855f7aa} }
      `}</style>

      {/* White flash overlay */}
      {flash && (
        <div style={{
          position: "fixed", inset: 0, background: "white", zIndex: 9999,
          animation: "wf_flashIn 0.38s ease-in-out forwards", pointerEvents: "none",
        }}/>
      )}

      {/* Coin balance */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        background: "#0d1424", borderRadius: 40, padding: "10px 24px",
        border: "1.5px solid #1e293b", marginBottom: 20,
      }}>
        <span style={{
          fontSize: "1.3rem",
          animation: pulling ? "wf_coinPop 0.4s ease-out" : undefined,
        }}>🪙</span>
        <span style={{ fontWeight: 900, fontSize: "1.15rem", color: "#f59e0b" }}>
          {coins.toLocaleString()}
        </span>
        <span style={{ fontSize: "0.68rem", color: "#475569" }}>เหรียญ</span>
      </div>

      {/* Pull buttons */}
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <button
          onClick={() => doPull(1)}
          disabled={!canX1}
          style={{
            padding: "13px 30px", borderRadius: 40, border: "none",
            background: canX1
              ? "linear-gradient(135deg,#7c3aed,#a855f7,#c084fc)"
              : "linear-gradient(135deg,#374151,#1f2937)",
            color: "white", fontWeight: 800, fontSize: "0.92rem",
            cursor: canX1 ? "pointer" : "not-allowed",
            opacity: coins < 5 ? 0.45 : 1,
            animation: canX1 ? "wf_btnPulse 2.5s ease-in-out infinite" : undefined,
            transition: "all 0.25s",
            transform: pulling ? "scale(0.97)" : "scale(1)",
          }}>
          🎴 ดึง ×1
          <span style={{ marginLeft: 8, fontSize: "0.75rem", color: "#fbbf24", fontWeight: 700 }}>5🪙</span>
        </button>

        <button
          onClick={() => doPull(10)}
          disabled={!canX10}
          style={{
            padding: "13px 30px", borderRadius: 40, border: "none",
            background: canX10
              ? "linear-gradient(135deg,#0369a1,#0ea5e9,#38bdf8)"
              : "linear-gradient(135deg,#374151,#1f2937)",
            color: "white", fontWeight: 800, fontSize: "0.92rem",
            cursor: canX10 ? "pointer" : "not-allowed",
            opacity: coins < 50 ? 0.45 : 1,
            boxShadow: canX10 ? "0 0 20px #0ea5e966" : "none",
            transition: "all 0.25s",
            transform: pulling ? "scale(0.97)" : "scale(1)",
          }}>
          🎴 ดึง ×10
          <span style={{ marginLeft: 8, fontSize: "0.75rem", color: "#fbbf24", fontWeight: 700 }}>50🪙</span>
        </button>
      </div>

      {/* Add coins (demo) */}
      <button
        onClick={() => setCoins(c => c + 50)}
        style={{
          padding: "6px 16px", borderRadius: 20, border: "1.5px solid #1e293b",
          background: "transparent", color: "#475569", fontSize: "0.68rem",
          fontWeight: 700, cursor: "pointer", marginBottom: 8, transition: "all 0.2s",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor="#475569"; e.currentTarget.style.color="#94a3b8"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor="#1e293b"; e.currentTarget.style.color="#475569"; }}
      >
        +50🪙 เติมเหรียญ
      </button>

      {/* Insufficient coins warning */}
      {!pulling && coins < 5 && (
        <div style={{ fontSize: "0.72rem", color: "#ef4444", marginTop: 4, fontWeight: 600 }}>
          เหรียญไม่พอ — กด เติมเหรียญ ด้านบน
        </div>
      )}

      {/* Pulling indicator */}
      {pulling && (
        <div style={{ marginTop: 28, color: "#64748b", fontSize: "0.9rem", letterSpacing: "0.05em" }}>
          ⏳ กำลังดึง...
        </div>
      )}

      {/* Results */}
      {!pulling && results.length === 1 && (
        <SingleReveal animal={results[0]}/>
      )}
      {!pulling && results.length === 10 && (
        <TenReveal animals={results}/>
      )}
    </div>
  );
}

// ── Leaderboard data ──────────────────────────────────────────────────────────

const LEADERBOARD = [
  { rank:1, name:"หมาป่าเดียวดาย", animal:"wolf",  elo:2480 },
  { rank:2, name:"จ้าวป่า",        animal:"tiger", elo:2210 },
  { rank:3, name:"ราชสีห์",        animal:"lion",  elo:2140 },
  { rank:4, name:"จิ้งจอกแดง",    animal:"fox",   elo:1890 },
  { rank:5, name:"อินทรีย์โบย",   animal:"eagle", elo:1750 },
  { rank:6, name:"งูเห่า",         animal:"snake", elo:1420 },
  { rank:7, name:"ฉลามขาว",        animal:"shark", elo:1310 },
  { rank:8, name:"หมีน้ำผึ้ง",    animal:"bear",  elo:980  },
];

export default function App() {
  const [tab, setTab] = useState("frames");
  return (
    <div style={{ minHeight:"100vh", background:"#060912", color:"white",
      fontFamily:"'Inter','Segoe UI',sans-serif", padding:"1.5rem 1rem" }}>
      <style>{`@keyframes titleFlow{0%{background-position:0% 50%}100%{background-position:200% 50%}}`}</style>

      <div style={{ textAlign:"center", marginBottom:"1.5rem" }}>
        <div style={{ fontSize:"0.65rem", color:"#f59e0b", letterSpacing:"0.2em", textTransform:"uppercase", marginBottom:6 }}>🏸 Badminton Club</div>
        <h1 style={{ fontSize:"2rem", fontWeight:900, margin:0,
          background:"linear-gradient(90deg,#f59e0b,#a855f7,#38bdf8,#f59e0b)",
          backgroundSize:"200% auto", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
          animation:"titleFlow 4s linear infinite" }}>Wildlife Gacha</h1>
      </div>

      <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:"2rem" }}>
        {["frames","leaderboard","gacha"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{
            padding:"8px 20px", borderRadius:20,
            background: tab===t?"#1e293b":"transparent",
            border:`1.5px solid ${tab===t?"#475569":"#1e293b"}`,
            color: tab===t?"#e2e8f0":"#475569",
            cursor:"pointer", fontWeight:700, fontSize:"0.78rem",
            letterSpacing:"0.05em", transition:"all 0.2s",
          }}>{{ frames:"🖼 กรอบ", leaderboard:"🏆 Leaderboard", gacha:"🎴 Gacha" }[t]}</button>
        ))}
      </div>

      {tab==="frames" && (
        <div style={{ maxWidth:820, margin:"0 auto" }}>
          {["secret","mythic","epic","uncommon","common"].map(tierKey=>{
            const tier=TIERS[tierKey];
            const animals=Object.entries(ANIMALS).filter(([,v])=>v.tier===tierKey);
            return (
              <div key={tierKey} style={{ marginBottom:"2.5rem" }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:"1.2rem", padding:"0 8px" }}>
                  <div style={{ fontSize:"0.62rem", fontWeight:900, color:tier.color,
                    textTransform:"uppercase", letterSpacing:"0.14em",
                    textShadow: tier.glow?`0 0 8px ${tier.color}`:undefined }}>
                    {tier.label}
                  </div>
                  <div style={{ flex:1, height:1, background:`${tier.color}33` }}/>
                  <div style={{ fontSize:"0.62rem", color:tier.color, fontWeight:700 }}>{tier.pct}</div>
                </div>
                <div style={{ display:"flex", gap:"2rem", flexWrap:"wrap",
                  justifyContent: animals.length===1?"center":"flex-start", paddingLeft:8 }}>
                  {animals.map(([animal])=><ProfileFrame key={animal} animal={animal} size={110}/>)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab==="leaderboard" && (
        <div style={{ maxWidth:520, margin:"0 auto", display:"flex", flexDirection:"column", gap:8 }}>
          {LEADERBOARD.map(p=><LeaderRow key={p.rank} {...p}/>)}
        </div>
      )}

      {tab==="gacha" && (
        <div style={{ maxWidth:480, margin:"0 auto" }}>
          <GachaSystem/>
        </div>
      )}
    </div>
  );
}
