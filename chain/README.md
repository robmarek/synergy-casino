# Synergy Casino dice on SynQ

`SynergyCasinoDice.synq` implements the browser dice table's payout arithmetic as a read-only quote. `quotePayout(stake, bet, firstDie, secondDie)` accepts a whole practice SNRG stake from 1 to 500, a bet name, and two die faces from 1 to 6.

| Bet | Winning sum | Gross return on a win |
| --- | --- | --- |
| `low` | 2–6 | 2× stake |
| `high` | 8–12 | 2× stake |
| `seven` | 7 | 5× stake |

Gross return includes the stake. A loss returns zero. The caller supplies the dice as test inputs, so the quote establishes arithmetic only. Browser balances and play history stay in the browser. The contract rejects attached native value.

## Build and test locally

Use Node.js, Rust 1.93.0, and adjacent Synergy checkouts of `synq-language` at `01125b6470c6b49c586b7a28fe054a62e1c913c6` and `synergy-aivm` at `1533d76ec84165c567f5d36e6bdd7e283e1a96a1`. From this directory run:

```sh
node local-aivm.mjs build /path/to/synergy-checkouts
node local-aivm.mjs test /path/to/synergy-checkouts
```

The build writes SynQ stateful IR v2, the ABI, and the Testnet v3 manifest for chain 1266 under `artifacts/`. Local AIVM tests check 216 quotes across all 36 die pairs, all three bets and both stake limits. They also verify invalid input reverts, native value rejection, unchanged state roots on quote calls, and empty transfer receipts.

## Public network boundary

Public Testnet v3 still needs a verified general-purpose SynQ admission path and canonical receipts. The offline CLI currently supports signing the no-argument subset and has no submission command. The SynQ whitepaper requires protocol-provided, Aegis-governed entropy. A native wagering release would need an unpredictable, verifiable outcome bound to an already committed wager, protection against replay or selective withholding, and atomic wallet-approved settlement with a funded payout reserve. [Forge AIVM runtime status](https://forge.synergy-network.io/build/aivm/overview) · [Synergy CLI limits](https://forge.synergy-network.io/tools/cli) · [SynQ deterministic execution specification](https://synergy-network.io/synq)
