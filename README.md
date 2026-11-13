# Synergy Casino

Play blackjack, single-zero roulette, two-dice high/low/seven, and Jacks or Better video poker using practice SNRG. Each session begins with 1,000 SNRG. The browser saves your balance, open hands, video poker holds, and recent results on this device.

In video poker, deal five cards, hold any cards you want to keep, then draw once. The displayed paytable gives the total return per 1 SNRG wagered, including the stake. Jacks or Better returns the original stake, a royal flush returns 800 times the wager, and the same paytable applies to every wager.

## Start the browser build

Serve the static files from the project directory and open [127.0.0.1:8764](http://127.0.0.1:8764/).

```sh
python3 -m http.server 8764 --bind 127.0.0.1 --directory dist
```

The browser tables use Web Crypto for randomness. Each table explains its payouts. The Testnet panel checks the identity of the public Synergy RPC and leaves the practice session independent of the response. Practice balances cannot be redeemed or transferred.

## Verify and build

```sh
node --test test/*.test.mjs
```

See [the SynQ dice quote prototype](chain/README.md) for the compiled Testnet v3 artifacts and local AIVM checks. It validates payout math against supplied dice values. The prototype leaves the ledger unchanged and rejects attached native value. [Native SNRG settlement requirements](docs/chain-status.md) cover the prerequisites for deployment, independently verifiable outcomes, and atomic payouts and refunds.

The lobby artwork uses original generated still lifes of playing cards, chips, a roulette wheel, and dice, with emerald felt, brass, and dark velvet.
