// Collator Monitor for Acurast — chain access and decoding.
// No dependencies: plain JSON-RPC over HTTPS, a few SCALE decoders, SS58 encoding.
// Works in the browser and in Node 18+ (global fetch, TextEncoder).

export const NETWORKS = {
  mainnet: {
    name: 'Mainnet',
    explorer: 'https://hub.acurast.com/explorer/address/',
    // Tried in this order; the next one is used when a request fails.
    rpcs: [
      { label: 'dishich.com archive RPC', url: 'https://acurast-rpc.dishich.com', batch: 50 },
      { label: 'Acurast public RPC', url: 'https://public-rpc.mainnet.acurast.com', batch: 10 },
    ],
  },
  canary: {
    name: 'Canary',
    explorer: null,
    rpcs: [
      { label: 'dishich.com RPC', url: 'https://acurast-canary-rpc.dishich.com', batch: 50 },
      { label: 'Acurast public RPC', url: 'https://public-rpc.canary.acurast.com', batch: 10 },
    ],
  },
};

// Storage keys: twox128(pallet) ++ twox128(item). Same layout on Mainnet and Canary.
export const KEYS = {
  validators: '0xcec5070d609dd3497f72bde07fc96ba088dcde934c658227ee1dfafcd6e16903', // Session.Validators
  sessionIndex: '0xcec5070d609dd3497f72bde07fc96ba072763800a36a99fdfc7c10f6415f6ee6', // Session.CurrentIndex
  invulnerables: '0x15464cac3378d46f113cd5b7a4d71c845579297f4dfb9609e7e4c2ebab9ce40a', // CollatorSelection.Invulnerables
  candidateList: '0x15464cac3378d46f113cd5b7a4d71c84ad588da1c23d1f764a5ff7b71e776f5a', // CollatorSelection.CandidateList
  lastAuthoredPrefix: '0x15464cac3378d46f113cd5b7a4d71c84fb8ec9656ba16ac6223a82470e54837f', // CollatorSelection.LastAuthoredBlock
};

const ACU_DECIMALS = 12;

// ---------- JSON-RPC ----------
let nextId = 1;

async function post(url, body, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) return res.json();
    if (attempt >= tries || (res.status !== 429 && res.status < 500)) {
      throw new Error(`RPC HTTP ${res.status}`);
    }
    await new Promise((r) => setTimeout(r, 400 * attempt));
  }
}

export async function rpc(url, method, params = []) {
  const j = await post(url, { id: nextId++, jsonrpc: '2.0', method, params });
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

// Many calls in batches of `size`, `parallel` batches in flight. Results keep the input order.
export async function rpcBatch(url, calls, size = 10, parallel = 4) {
  const out = new Array(calls.length);
  let next = 0;
  async function worker() {
    while (next < calls.length) {
      const start = next;
      next += size;
      const chunk = calls.slice(start, start + size);
      const body = chunk.map(([method, params], k) => ({ id: start + k, jsonrpc: '2.0', method, params }));
      const res = await post(url, body);
      if (!Array.isArray(res)) throw new Error(res.error ? res.error.message : 'unexpected batch response');
      for (const r of res) {
        if (r.error) throw new Error(r.error.message);
        out[r.id] = r.result;
      }
    }
  }
  const workers = Math.max(1, Math.min(parallel, Math.ceil(calls.length / size)));
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}

// ---------- bytes and SCALE ----------
export function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

export function bytesToHex(b) {
  let s = '0x';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

function compact(b, off) {
  const mode = b[off] & 3;
  if (mode === 0) return [b[off] >>> 2, 1];
  if (mode === 1) return [(b[off] | (b[off + 1] << 8)) >>> 2, 2];
  if (mode === 2) return [(b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 2, 4];
  throw new Error('compact length too large');
}

// Vec<T> of fixed-size items. Throws if the length does not add up: a runtime layout change fails loudly.
export function decodeVec(hex, itemLen) {
  if (!hex) return [];
  const b = hexToBytes(hex);
  const [n, off] = compact(b, 0);
  if (off + n * itemLen !== b.length) throw new Error('unexpected storage layout');
  const items = [];
  for (let i = 0; i < n; i++) items.push(b.slice(off + i * itemLen, off + (i + 1) * itemLen));
  return items;
}

function leToBigInt(bytes) {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

export function decodeU32(hex) {
  if (!hex) return null;
  return Number(leToBigInt(hexToBytes(hex)));
}

export function formatAcu(planck) {
  const s = planck.toString().padStart(ACU_DECIMALS + 1, '0');
  const whole = s.slice(0, -ACU_DECIMALS);
  const frac = s.slice(-ACU_DECIMALS).slice(0, 3).replace(/0+$/, ''); // up to 3 decimals, e.g. 0.016
  return Number(whole).toLocaleString('en-US') + (frac ? '.' + frac : '');
}

// Aura pre-runtime digest: 0x06 ++ "aura" ++ compact(8) ++ slot (u64 LE).
export function auraSlot(logs) {
  for (const l of logs) {
    if (l.startsWith('0x0661757261') && l.slice(12, 14) === '20') return leToBigInt(hexToBytes(l.slice(14, 30)));
  }
  return null;
}

// Aura consensus digest (0x04 ++ "aura" ++ …) = authority set changed in this block.
export function auraChange(logs) {
  return logs.some((l) => l.startsWith('0x0461757261'));
}

// ---------- BLAKE2b-512 (RFC 7693), 64-bit words as uint32 pairs ----------
const IV = new Uint32Array([
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a,
  0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
]);
const SIGMA = new Uint8Array([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
  11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4, 7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8,
  9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13, 2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9,
  12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11, 13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10,
  6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5, 10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
].map((x) => x * 2));
const V = new Uint32Array(32);
const M = new Uint32Array(32);

function add64(a, b) {
  const lo = V[a] + V[b];
  let hi = V[a + 1] + V[b + 1];
  if (lo >= 0x100000000) hi++;
  V[a] = lo;
  V[a + 1] = hi;
}
function add64c(a, lo0, hi0) {
  const lo = V[a] + lo0;
  let hi = V[a + 1] + hi0;
  if (lo >= 0x100000000) hi++;
  V[a] = lo;
  V[a + 1] = hi;
}
function g(a, b, c, d, ix, iy) {
  add64(a, b); add64c(a, M[ix], M[ix + 1]);
  let x0 = V[d] ^ V[a], x1 = V[d + 1] ^ V[a + 1];
  V[d] = x1; V[d + 1] = x0;
  add64(c, d);
  x0 = V[b] ^ V[c]; x1 = V[b + 1] ^ V[c + 1];
  V[b] = (x0 >>> 24) ^ (x1 << 8); V[b + 1] = (x1 >>> 24) ^ (x0 << 8);
  add64(a, b); add64c(a, M[iy], M[iy + 1]);
  x0 = V[d] ^ V[a]; x1 = V[d + 1] ^ V[a + 1];
  V[d] = (x0 >>> 16) ^ (x1 << 16); V[d + 1] = (x1 >>> 16) ^ (x0 << 16);
  add64(c, d);
  x0 = V[b] ^ V[c]; x1 = V[b + 1] ^ V[c + 1];
  V[b] = (x1 >>> 31) ^ (x0 << 1); V[b + 1] = (x0 >>> 31) ^ (x1 << 1);
}
function compress(ctx, last) {
  for (let i = 0; i < 16; i++) { V[i] = ctx.h[i]; V[i + 16] = IV[i]; }
  V[24] ^= ctx.t; V[25] ^= ctx.t / 0x100000000;
  if (last) { V[28] = ~V[28]; V[29] = ~V[29]; }
  for (let i = 0; i < 32; i++) {
    const p = 4 * i;
    M[i] = ctx.b[p] ^ (ctx.b[p + 1] << 8) ^ (ctx.b[p + 2] << 16) ^ (ctx.b[p + 3] << 24);
  }
  for (let r = 0; r < 12; r++) {
    const s = r * 16;
    g(0, 8, 16, 24, SIGMA[s], SIGMA[s + 1]);
    g(2, 10, 18, 26, SIGMA[s + 2], SIGMA[s + 3]);
    g(4, 12, 20, 28, SIGMA[s + 4], SIGMA[s + 5]);
    g(6, 14, 22, 30, SIGMA[s + 6], SIGMA[s + 7]);
    g(0, 10, 20, 30, SIGMA[s + 8], SIGMA[s + 9]);
    g(2, 12, 22, 24, SIGMA[s + 10], SIGMA[s + 11]);
    g(4, 14, 16, 26, SIGMA[s + 12], SIGMA[s + 13]);
    g(6, 8, 18, 28, SIGMA[s + 14], SIGMA[s + 15]);
  }
  for (let i = 0; i < 16; i++) ctx.h[i] ^= V[i] ^ V[i + 16];
}
export function blake2b(input, outlen = 64) {
  const ctx = { b: new Uint8Array(128), h: new Uint32Array(IV), t: 0, c: 0 };
  ctx.h[0] ^= 0x01010000 ^ outlen;
  for (let i = 0; i < input.length; i++) {
    if (ctx.c === 128) { ctx.t += ctx.c; compress(ctx, false); ctx.c = 0; }
    ctx.b[ctx.c++] = input[i];
  }
  ctx.t += ctx.c;
  while (ctx.c < 128) ctx.b[ctx.c++] = 0;
  compress(ctx, true);
  const out = new Uint8Array(outlen);
  for (let i = 0; i < outlen; i++) out[i] = ctx.h[i >> 2] >> (8 * (i & 3));
  return out;
}

// ---------- SS58 ----------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
  return s;
}
const SS58PRE = new TextEncoder().encode('SS58PRE');
export function ss58(pub, prefix = 42) {
  const data = new Uint8Array(1 + pub.length);
  data[0] = prefix;
  data.set(pub, 1);
  const pre = new Uint8Array(SS58PRE.length + data.length);
  pre.set(SS58PRE);
  pre.set(data, SS58PRE.length);
  const sum = blake2b(pre).slice(0, 2);
  const full = new Uint8Array(data.length + 2);
  full.set(data);
  full.set(sum, data.length);
  return base58(full);
}

// ---------- snapshot ----------
// cache: Map(blockHash -> {n, slot, change}) kept between refreshes, so only new headers are fetched.
export async function snapshot(rpcCfg, windowSize, cache = new Map()) {
  const url = rpcCfg.url;
  const head = await rpc(url, 'chain_getHeader');
  const best = parseInt(head.number, 16);
  const from = Math.max(1, best - windowSize + 1);
  const nums = [];
  for (let n = from; n <= best; n++) nums.push(n);
  const hashes = await rpc(url, 'chain_getBlockHash', [nums]);
  const at = hashes[hashes.length - 1];

  const [valsHex, invHex, candHex, sessHex, lastKeys] = await Promise.all([
    rpc(url, 'state_getStorage', [KEYS.validators, at]),
    rpc(url, 'state_getStorage', [KEYS.invulnerables, at]),
    rpc(url, 'state_getStorage', [KEYS.candidateList, at]),
    rpc(url, 'state_getStorage', [KEYS.sessionIndex, at]),
    rpc(url, 'state_getKeysPaged', [KEYS.lastAuthoredPrefix, 1000, null, at]),
  ]);
  const lastSets = lastKeys.length ? await rpc(url, 'state_queryStorageAt', [lastKeys, at]) : [];
  const lastAuthored = new Map(); // pub hex -> block
  for (const set of lastSets) {
    for (const [key, val] of set.changes) {
      if (val) lastAuthored.set('0x' + key.slice(-64), decodeU32(val));
    }
  }

  const need = hashes.filter((h) => !cache.has(h));
  const headers = await rpcBatch(url, need.map((h) => ['chain_getHeader', [h]]), rpcCfg.batch, 4);
  need.forEach((h, i) => {
    const logs = headers[i].digest.logs;
    cache.set(h, { n: parseInt(headers[i].number, 16), slot: auraSlot(logs), change: auraChange(logs) });
  });
  const keep = new Set(hashes);
  for (const h of cache.keys()) if (!keep.has(h)) cache.delete(h);

  const validators = decodeVec(valsHex, 32);
  const invulnerables = new Set(decodeVec(invHex, 32).map(bytesToHex));
  const candidates = new Map(decodeVec(candHex, 48).map((c) => [bytesToHex(c.slice(0, 32)), leToBigInt(c.slice(32, 48))]));
  const N = validators.length;
  if (!N) throw new Error('empty validator set');
  const bigN = BigInt(N);

  // Blocks after the last authority-set change in the window use the current Session.Validators order.
  const blocks = hashes.map((h) => cache.get(h));
  let start = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].change) { start = i + 1; break; }
  }
  const authored = new Array(N).fill(0);
  const missed = new Array(N).fill(0);
  let missedTotal = 0;
  let counted = 0;
  for (let i = start; i < blocks.length; i++) {
    const s = blocks[i].slot;
    if (s === null) continue;
    authored[Number(s % bigN)]++;
    counted++;
    const prev = i > start ? blocks[i - 1].slot : null;
    if (prev !== null && s > prev + 1n) {
      const gap = s - prev - 1n;
      const cap = gap < bigN * 10n ? gap : bigN * 10n;
      for (let k = 1n; k <= cap; k++) { missed[Number((prev + k) % bigN)]++; missedTotal++; }
    }
  }
  const first = blocks[start] ? blocks[start].slot : null;
  const lastSlot = blocks[blocks.length - 1].slot;
  const slotMs = lastSlot ? Math.round(Date.now() / Number(lastSlot) / 500) * 500 : 6000;
  const blockSec = first !== null && counted > 1 ? (Number(lastSlot - first) * slotMs) / 1000 / (counted - 1) : slotMs / 1000;

  const rows = validators.map((pub, i) => {
    const hex = bytesToHex(pub);
    const last = lastAuthored.has(hex) ? lastAuthored.get(hex) : null;
    const turns = authored[i] + missed[i];
    return {
      turn: i,
      pub: hex,
      address: ss58(pub),
      kind: invulnerables.has(hex) ? 'invulnerable' : 'candidate',
      deposit: candidates.has(hex) ? candidates.get(hex) : null,
      lastAuthored: last,
      lag: last === null ? null : best - last,
      authored: authored[i],
      missed: missed[i],
      reliability: turns ? authored[i] / turns : null,
    };
  });
  const active = new Set(rows.map((r) => r.pub));
  const waiting = [...candidates.entries()]
    .filter(([hex]) => !active.has(hex))
    .map(([hex, deposit]) => ({
      pub: hex,
      address: ss58(hexToBytes(hex)),
      deposit,
      lastAuthored: lastAuthored.has(hex) ? lastAuthored.get(hex) : null,
    }));

  return {
    best,
    session: decodeU32(sessHex),
    N,
    invulnerableCount: rows.filter((r) => r.kind === 'invulnerable').length,
    window: { requested: windowSize, blocks: counted, from: blocks[start] ? blocks[start].n : best, setChanged: start > 0 },
    slotsTotal: counted + missedTotal,
    missedTotal,
    slotMs,
    blockSec,
    rows,
    waiting,
    fetchedHeaders: need.length,
  };
}
