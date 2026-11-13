# Collator Monitor for Acurast

Live view of the [Acurast](https://acurast.com) Mainnet and Canary collator sets: whose turn it is,
who authored, who missed their slot, and when each collator last made it into the chain.

**Open it:** https://dishich.github.io/acurast-collator-monitor/ (`#mainnet` or `#canary`)

No backend, nothing stored. Your browser reads the chain directly from a public RPC node
(the dishich.com RPC first, the Acurast public RPC as a fallback) and refreshes every minute.

## What it shows

- **Turn**: position in `Session.Validators`. Acurast uses Aura, so block production is a
  round-robin: the 6-second slot `s` belongs to the collator at position `s mod N`.
- **Authored · missed**: for every block in the window (≈30 min, 1 h or 3 h) the slot is read
  from the block header's Aura pre-runtime digest and credited to the collator whose turn it was.
  A slot without a block counts as missed for that collator.
- **Last block**: `CollatorSelection.LastAuthoredBlock`, the value the chain uses to remove
  candidates that stopped authoring.
- **Role**: invulnerable or candidate, with the candidate deposit from `CollatorSelection.CandidateList`.
- **Status**: *On track* (authored on its last turn), *Missed* (the last 1–2 turns passed without a
  block), *Silent* (3 or more).

If the authority set changed inside the window (an Aura consensus digest in a header), only
blocks after the change are counted, so turns are never attributed with the wrong set.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000/#mainnet
node selftest.mjs             # BLAKE2b and SS58 vectors + a live snapshot of both networks
```

Everything is in two files: `chain.js` (JSON-RPC, SCALE decoding, BLAKE2b/SS58, the round-robin
accounting; no dependencies, also runs in Node 18+) and `index.html` (the page).

## Limits

- Storage keys are pinned. If a runtime upgrade changes the layout of these items, decoding fails
  loudly instead of showing wrong numbers.
- Times are estimates from slot numbers.
- The Acurast public RPC allows at most 10 requests per batch, so a cold load through it is slower.

Community tool, not affiliated with Acurast. Built by [@dishich_ofc](https://x.com/dishich_ofc),
who runs Acurast Mainnet and Canary collators and public RPC nodes in Lisbon.

MIT licensed.
