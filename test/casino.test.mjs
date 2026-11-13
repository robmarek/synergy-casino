import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CURRENCY, DICE_BETS, MAX_BET, ROULETTE_WHEEL, START_BALANCE,
  canDoubleBlackjack, createSession, doubleBlackjack, hitBlackjack, loadSession, rollDice,
  rouletteColor, saveSession, scoreHand, secureRandomInt, spinRoulette, standBlackjack, startBlackjack,
} from '../dist/casino.mjs';

function card(rank, suit = 'clubs') {
  return { rank, suit };
}

function withDraws(...draws) {
  const state = createSession();
  const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = suits.flatMap((suit) => ranks.map((rank) => card(rank, suit)));
  state.shoe = [
    ...deck.filter((candidate) => !draws.some((draw) => candidate.rank === draw.rank && candidate.suit === draw.suit)),
    ...[...draws].reverse(),
  ];
  return state;
}

function numbers(...values) {
  return () => {
    assert.ok(values.length > 0, 'ran out of supplied random values');
    return values.shift();
  };
}

test('starts a practice SNRG session and rejects wagers outside the balance and limits', () => {
  const state = createSession();
  assert.equal(CURRENCY, 'SNRG');
  assert.equal(state.balance, START_BALANCE);
  assert.deepEqual(state.stats, { rounds: 0, wagered: 0, returned: 0 });
  assert.deepEqual(loadSession(saveSession(state)), state);
  for (const stake of [0, -1, MAX_BET + 1, 1.5, Infinity, '5']) {
    assert.throws(() => spinRoulette(state, stake, { type: 'red' }), /whole wager/);
  }
  const lost = spinRoulette(state, MAX_BET, { type: 'red' }, numbers(0));
  assert.throws(() => rollDice({ ...lost, balance: 5 }, 6, 'low'), /too low/);
  assert.throws(() => spinRoulette(state, 1, { type: 'number', number: 37 }), /number from 0 to 36/);
  assert.throws(() => rollDice(state, 1, ['low']), /Choose Low/);
  assert.throws(() => rollDice(state, 1, 'low', numbers(6)), /invalid result/);
  assert.equal(state.balance, START_BALANCE);
});

test('secure sampling discards the biased tail of the 32-bit range', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const samples = [0xffffffff, 0xfffffffe, 11, 0xffffffff];
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues(array) { array[0] = samples.shift(); } },
  });
  try {
    assert.equal(secureRandomInt(6), 5);
    assert.equal(secureRandomInt(2 ** 32), 0xffffffff);
    assert.equal(samples.length, 0);
    assert.throws(() => secureRandomInt(0), /random range/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else delete globalThis.crypto;
  }
});

test('blackjack ace scoring chooses a soft total when it fits', () => {
  assert.deepEqual(scoreHand([card('A'), card('6')]), { total: 17, soft: true });
  assert.deepEqual(scoreHand([card('A'), card('6'), card('10')]), { total: 17, soft: false });
  assert.deepEqual(scoreHand([card('A'), card('A', 'diamonds'), card('9')]), { total: 21, soft: true });
});

test('blackjack handles player natural, dealer natural and mutual naturals', () => {
  const natural = startBlackjack(withDraws(card('A'), card('9'), card('K'), card('8')), 5);
  assert.equal(natural.blackjack.status, 'blackjack');
  assert.equal(natural.blackjack.payout, 12.5);
  assert.equal(natural.blackjack.net, 7.5);
  assert.equal(natural.balance, START_BALANCE + 7.5);
  assert.deepEqual(loadSession(saveSession(natural)), natural);

  const push = startBlackjack(withDraws(card('A'), card('A', 'hearts'), card('K'), card('J')), 25);
  assert.equal(push.blackjack.status, 'push');
  assert.equal(push.blackjack.payout, 25);
  assert.equal(push.balance, START_BALANCE);

  const lost = startBlackjack(withDraws(card('9'), card('A'), card('8'), card('Q')), 25);
  assert.equal(lost.blackjack.status, 'loss');
  assert.equal(lost.blackjack.payout, 0);
  assert.equal(lost.balance, START_BALANCE - 25);
});

test('blackjack deals alternating cards without replacement and stands on soft 17', () => {
  const state = withDraws(card('10'), card('A'), card('8'), card('6'), card('K'));
  const dealt = startBlackjack(state, 25);
  assert.equal(dealt.blackjack.status, 'playing');
  assert.deepEqual(dealt.blackjack.player, [card('10'), card('8')]);
  assert.deepEqual(dealt.blackjack.dealer, [card('A'), card('6')]);
  assert.equal(dealt.blackjack.payout, null);
  assert.equal(dealt.balance, START_BALANCE - 25);
  assert.equal(state.shoe.length, 52);
  assert.equal(dealt.shoe.length, 48);
  assert.throws(() => startBlackjack(dealt, 25), /current blackjack hand/);
  const settled = standBlackjack(dealt);
  assert.equal(settled.blackjack.status, 'win');
  assert.equal(settled.blackjack.dealer.length, 2);
  assert.equal(settled.blackjack.payout, 50);
  assert.equal(settled.balance, START_BALANCE + 25);
  assert.throws(() => hitBlackjack(settled), /Deal a blackjack hand/);
  assert.deepEqual(loadSession(saveSession(settled)), settled);
});

test('hitting a bust loses immediately and a hit to 21 plays the dealer', () => {
  const bust = startBlackjack(withDraws(card('10'), card('9'), card('8'), card('6'), card('4')), 25);
  const lost = hitBlackjack(bust);
  assert.equal(lost.blackjack.status, 'loss');
  assert.equal(lost.blackjack.dealer.length, 2);
  assert.equal(bust.blackjack.player.length, 2);
  assert.equal(lost.balance, START_BALANCE - 25);

  const playable = startBlackjack(withDraws(card('10'), card('9'), card('8'), card('6'), card('3'), card('4')), 25);
  const won = hitBlackjack(playable);
  assert.equal(won.blackjack.status, 'win');
  assert.equal(scoreHand(won.blackjack.player).total, 21);
  assert.equal(scoreHand(won.blackjack.dealer).total, 19);
});

test('double down reserves one extra stake, draws once and settles', () => {
  const hand = withDraws(card('5'), card('9'), card('6'), card('7'), card('K'), card('4'));
  const active = startBlackjack(hand, 20);
  assert.equal(canDoubleBlackjack(active), true);
  assert.equal(canDoubleBlackjack({ ...active, balance: 19 }), false);
  const result = doubleBlackjack(active);
  assert.equal(result.blackjack.status, 'win');
  assert.equal(result.blackjack.player.length, 3);
  assert.equal(result.blackjack.stake, 40);
  assert.equal(result.blackjack.payout, 80);
  assert.equal(result.balance, START_BALANCE + 40);
  assert.deepEqual(result.stats, { rounds: 1, wagered: 40, returned: 80 });
  assert.throws(() => doubleBlackjack(result), /first two cards/);

  const hit = hitBlackjack(startBlackjack(withDraws(card('5'), card('9'), card('6'), card('7'), card('2')), 20));
  assert.equal(hit.blackjack.status, 'playing');
  assert.equal(canDoubleBlackjack(hit), false);
});

test('the blackjack shoe persists across hands and shuffles below the cut', () => {
  let calls = 0;
  const ordered = (max) => {
    calls += 1;
    return max - 1;
  };
  const first = standBlackjack(startBlackjack(createSession(), 1, ordered));
  assert.equal(calls, 51);
  assert.equal(first.blackjack.status, 'push');
  const second = startBlackjack(first, 1, ordered);
  assert.equal(calls, 51);
  const cards = [first.blackjack, second.blackjack].flatMap(({ player, dealer }) => [...player, ...dealer]);
  assert.equal(new Set(cards.map(({ rank, suit }) => `${rank} ${suit}`)).size, 8);
  assert.equal(second.shoe.length, 44);
  const settled = standBlackjack(second);
  const belowCut = { ...settled, shoe: settled.shoe.slice(0, 25) };
  const refreshed = startBlackjack(belowCut, 1, ordered);
  assert.equal(calls, 102);
  assert.equal(refreshed.shoe.length, 48);
});

test('single-zero roulette pays every exact result and settles outside bets correctly', () => {
  assert.deepEqual([...ROULETTE_WHEEL].sort((a, b) => a - b), Array.from({ length: 37 }, (_, number) => number));
  const state = createSession();
  const colors = { red: 0, black: 0, green: 0 };
  for (const number of ROULETTE_WHEEL) {
    const color = rouletteColor(number);
    colors[color] += 1;
    const exact = spinRoulette(state, 5, { type: 'number', number }, numbers(number));
    assert.equal(exact.roulette.payout, 180);
    assert.equal(exact.roulette.net, 175);
    assert.equal(exact.roulette.color, color);
    for (const type of ['red', 'black', 'odd', 'even']) {
      const payout = spinRoulette(state, 5, { type }, numbers(number)).roulette.payout;
      const parity = number % 2 ? 'odd' : 'even';
      assert.equal(payout, number !== 0 && (type === color || type === parity) ? 10 : 0);
    }
  }
  assert.deepEqual(colors, { red: 18, black: 18, green: 1 });
  assert.equal(state.balance, START_BALANCE);
});

test('dice settles all 36 equally likely results at the listed payout', () => {
  const state = createSession();
  const wins = { low: 0, high: 0, seven: 0 };
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      const sum = first + second;
      const winningBet = sum < 7 ? 'low' : sum > 7 ? 'high' : 'seven';
      for (const bet of Object.keys(DICE_BETS)) {
        const result = rollDice(state, 10, bet, numbers(first - 1, second - 1));
        assert.deepEqual(result.dice.dice, [first, second]);
        assert.equal(result.dice.sum, sum);
        assert.equal(result.dice.payout, bet === winningBet ? (bet === 'seven' ? 50 : 20) : 0);
        assert.equal(result.balance, START_BALANCE + result.dice.net);
        if (result.dice.status === 'win') wins[bet] += 1;
      }
    }
  }
  assert.deepEqual(wins, { low: 15, high: 15, seven: 6 });
});

test('an open blackjack stake survives reload and other table results', () => {
  const hand = startBlackjack(withDraws(card('10'), card('9'), card('8'), card('7'), card('A')), 40);
  const otherTable = rollDice(hand, 10, 'seven', numbers(0, 5));
  const loaded = loadSession(saveSession(otherTable));
  assert.deepEqual(loaded, otherTable);
  assert.equal(loaded.blackjack.status, 'playing');
  assert.equal(loaded.balance, START_BALANCE);
  assert.equal(loaded.stats.wagered, 10);
  const result = standBlackjack(loaded);
  assert.equal(result.blackjack.status, 'win');
  assert.equal(result.balance, START_BALANCE + 80);
  assert.deepEqual(result.history.map(({ id, game }) => [id, game]), [[2, 'blackjack'], [1, 'dice']]);
  assert.deepEqual(result.stats, { rounds: 2, wagered: 50, returned: 130 });
});

test('save validation checks accounting, card uniqueness and wager results', () => {
  const state = createSession();
  assert.throws(() => loadSession('{'), /could not be read/);
  assert.throws(() => loadSession(saveSession({ ...state, balance: 999 })), /invalid/);
  const hand = startBlackjack(withDraws(card('10'), card('9'), card('8'), card('7')), 1);
  assert.throws(() => loadSession(saveSession({ ...hand, shoe: [...hand.shoe, hand.blackjack.player[0]] })), /invalid/);
  const dice = rollDice(state, 1, 'low', numbers(0, 0));
  assert.throws(() => loadSession(saveSession({ ...dice, dice: { ...dice.dice, sum: 5 } })), /invalid/);
  assert.throws(() => loadSession(saveSession({ ...dice, dice: { ...dice.dice, bet: ['low'] } })), /invalid/);
});

test('recent history caps at 30 results while session stats retain every wager', () => {
  let state = createSession();
  for (let round = 0; round < 40; round += 1) {
    state = spinRoulette(state, 1, { type: 'red' }, numbers(1));
  }
  assert.equal(state.history.length, 30);
  assert.equal(state.history[0].id, 40);
  assert.equal(state.history.at(-1).id, 11);
  assert.deepEqual(state.stats, { rounds: 40, wagered: 40, returned: 80 });
  assert.equal(state.balance, START_BALANCE + 40);
  assert.deepEqual(loadSession(saveSession(state)), state);
});
