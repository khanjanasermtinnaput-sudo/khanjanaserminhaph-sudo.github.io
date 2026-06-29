// Supabase Edge Function: gacha-pull
// Server-side gacha roll using cryptographic RNG — replaces client-side Math.random() (CRIT-02)
// Deploy: supabase functions deploy gacha-pull

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://khanjanaserminhaph-sudo-github-io.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Outcome pools (must sum to 100%)
const GACHA_POOLS = {
  secret: {
    weight: 3,
    items: [
      { type: 'gacha_frame',  value: 'solar',   label: '☀️ Solar Emperor Frame' },
      { type: 'gacha_frame',  value: 'thunder',  label: '⚡ Thunder God Frame' },
      { type: 'gacha_effect', value: 'rotating_arcs', label: '⚡ Thunder God Effect' },
    ]
  },
  ultra: {
    weight: 10,
    items: [
      { type: 'gacha_frame', value: 'void',  label: '🌑 Void Abyss Frame' },
      { type: 'gacha_frame', value: 'halo',  label: '✨ Celestial Halo Frame' },
      { type: 'gacha_name',  value: 'solar', label: '☀️ Solar Script' },
    ]
  },
  rare: {
    weight: 30,
    items: [
      { type: 'gacha_frame', value: 'blaze', label: '🔥 Crimson Blaze Frame' },
      { type: 'gacha_frame', value: 'ice',   label: '❄️ Phantom Ice Frame' },
      { type: 'gacha_name',  value: 'void',  label: '🌑 Void Corruption' },
      { type: 'gacha_name',  value: 'halo',  label: '✨ Celestial Script' },
    ]
  },
  common: {
    weight: 57,
    items: [
      { type: 'gacha_emoji', value: '🏸', label: '🏸 Shuttlecock' },
      { type: 'gacha_emoji', value: '🔥', label: '🔥 Fire' },
      { type: 'gacha_emoji', value: '⚡', label: '⚡ Lightning' },
      { type: 'gacha_emoji', value: '🌟', label: '🌟 Star' },
      { type: 'gacha_emoji', value: '💥', label: '💥 Explosion' },
      { type: 'gacha_emoji', value: '🎯', label: '🎯 Target' },
      { type: 'gacha_emoji', value: '🦅', label: '🦅 Eagle' },
      { type: 'gacha_emoji', value: '🌊', label: '🌊 Wave' },
    ]
  },
};

const PULL_COST = 2;  // Matches app's 2-coin single pull cost

function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0xFFFFFFFF;
}

function pickTier(roll: number): string {
  let cum = 0;
  for (const [tier, pool] of Object.entries(GACHA_POOLS)) {
    cum += pool.weight;
    if (roll * 100 < cum) return tier;
  }
  return 'common';
}

function pickItem(tier: string) {
  const pool = GACHA_POOLS[tier as keyof typeof GACHA_POOLS];
  const idx = Math.floor(cryptoRandom() * pool.items.length);
  return pool.items[idx];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    const body = await req.json().catch(() => ({}));
    const playerId: number = parseInt(body.player_id);
    if (!playerId || isNaN(playerId)) {
      return new Response(JSON.stringify({ error: 'invalid_player_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch player and check coins atomically via RPC
    const { data: rollResult, error: rollErr } = await supabase
      .rpc('gacha_pull', { p_player_id: playerId });

    if (rollErr) {
      const msg = rollErr.message || '';
      const status = msg.includes('insufficient_coins') ? 402
                   : msg.includes('player_not_found') ? 404 : 500;
      return new Response(JSON.stringify({ error: msg }), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const tier = rollResult.outcome as string;
    const item = pickItem(tier);

    // Apply item to player inventory
    if (item.type === 'gacha_frame') {
      const { data: invData } = await supabase
        .from('players').select('gacha_inventory').eq('id', playerId).single();
      const inv = JSON.parse(invData?.gacha_inventory || '{}');
      if (!inv.frames) inv.frames = [];
      if (!inv.frames.includes(item.value)) inv.frames.push(item.value);
      await supabase.from('players').update({ gacha_inventory: JSON.stringify(inv) }).eq('id', playerId);

    } else if (item.type === 'gacha_name') {
      const { data: invData } = await supabase
        .from('players').select('gacha_inventory').eq('id', playerId).single();
      const inv = JSON.parse(invData?.gacha_inventory || '{}');
      if (!inv.names) inv.names = [];
      if (!inv.names.includes(item.value)) inv.names.push(item.value);
      await supabase.from('players').update({ gacha_inventory: JSON.stringify(inv) }).eq('id', playerId);

    } else if (item.type === 'gacha_emoji') {
      // Emoji just equips directly; add to inv
      const { data: invData } = await supabase
        .from('players').select('gacha_inventory').eq('id', playerId).single();
      const inv = JSON.parse(invData?.gacha_inventory || '{}');
      if (!inv.emojis) inv.emojis = [];
      if (!inv.emojis.includes(item.value)) inv.emojis.push(item.value);
      await supabase.from('players').update({
        gacha_inventory: JSON.stringify(inv),
        gacha_emoji: item.value
      }).eq('id', playerId);

    } else if (item.type === 'gacha_effect') {
      const { data: pl } = await supabase
        .from('players').select('owned_effects').eq('id', playerId).single();
      const effects: string[] = JSON.parse(pl?.owned_effects || '[]');
      if (!effects.includes(item.value)) effects.push(item.value);
      await supabase.from('players').update({ owned_effects: JSON.stringify(effects) }).eq('id', playerId);
    }

    return new Response(JSON.stringify({
      tier,
      item,
      roll: rollResult.roll,
      coins_remaining: rollResult.coins_remaining,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
