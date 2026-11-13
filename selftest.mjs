import { NETWORKS, snapshot, ss58, hexToBytes, blake2b, bytesToHex } from './chain.js';
// BLAKE2b-512 test vector (RFC 7693 Appendix A: "abc")
const abc = bytesToHex(blake2b(new TextEncoder().encode('abc')));
const want = '0xba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923';
console.log('blake2b abc:', abc === want ? 'OK' : 'FAIL ' + abc);
const ours = ss58(hexToBytes('0xd04eae1278b997d8801a69f705efe2320826980edd2ea08bdcef98d6fff8bd3f'));
console.log('ss58 mainnet collator:', ours, ours === '5GmqByTFygLgRptjhzPpeYnMa9K2fQ6XrufrpovNHb2TNMot' ? 'OK' : 'FAIL');
const can = ss58(hexToBytes('0xa66c5f00ad8b061f6d71f65ca3fa74837aaadde6f891e1d14c3e55bb5eefa13a'));
console.log('ss58 canary collator:', can === '5FpuztmTD8axyhDa3d5jXSATQhufG3c6TaADw7kbPYFb6wYJ' ? 'OK' : 'FAIL ' + can);
for (const [net, cfgi] of [['mainnet', 0], ['canary', 0], ['mainnet', 1]]) {
  const t = Date.now();
  const s = await snapshot(NETWORKS[net].rpcs[cfgi], 600);
  console.log(`\n${net} via ${NETWORKS[net].rpcs[cfgi].label}: ${((Date.now()-t)/1000).toFixed(1)}s best=${s.best} session=${s.session} N=${s.N} inv=${s.invulnerableCount} window=${JSON.stringify(s.window)} slots=${s.slotsTotal} missed=${s.missedTotal} slotMs=${s.slotMs} blockSec=${s.blockSec.toFixed(2)} waiting=${s.waiting.length}`);
  for (const r of s.rows) console.log(String(r.turn).padStart(2), r.address.slice(0,8), r.kind.padEnd(12), (r.deposit===null?'-':String(r.deposit/10n**12n)).padStart(8), 'last', r.lastAuthored, 'lag', r.lag, 'auth', r.authored, 'miss', r.missed, r.reliability===null?'-':(r.reliability*100).toFixed(0)+'%');
}
