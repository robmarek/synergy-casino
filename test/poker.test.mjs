import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_BET, POKER_PAYTABLE, START_BALANCE, createSession, drawVideoPoker, loadSession,
  rollDice, saveSession, scorePokerHand, standBlackjack, startBlackjack, startVideoPoker,
  togglePokerHold,
} from '../dist/casino.mjs';

const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const suits = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };

function cards(notation) {
  return notation.split(' ').map((card) => ({ rank: card.slice(0, -1), suit: suits[card.at(-1)] }));
}

function orderedDraws(notation) {
  const firstDraws = cards(notation);
  const fullDeck = Object.values(suits).flatMap((suit) => ranks.map((rank) => ({ rank, suit })));
  const key = ({ rank, suit }) => `${rank} ${suit}`;
  const drawn = new Set(firstDraws.map(key));
  const target = [...fullDeck.filter((card) => !drawn.has(key(card))), ...firstDraws.reverse()];
  return (max) => {
    const index = max - 1;
    const other = fullDeck.findIndex((card) => key(card) === key(target[index]));
    assert.ok(other <= index);
    [fullDeck[index], fullDeck[other]] = [fullDeck[other], fullDeck[index]];
    return other;
  };
}

const payingHands = [
  ['royal-flush', 800, 'As Ks Qs Js 10s'],
  ['straight-flush', 50, '2d 3d 4d 5d Ad'],
  ['four-of-a-kind', 25, '5d 5h 5s 5c As'],
  ['full-house', 9, '7d 7h 7s Ac Ah'],
  ['flush', 6, '2d 3d 8d Jd Ad'],
  ['straight', 4, '10d Jc Qd Kh As'],
  ['three-of-a-kind', 3, '7d 7h 7s Ac 3h'],
  ['two-pair', 2, '2d 2h 3s 3c As'],
  ['jacks-or-better', 1, 'Jd Jh 3s 5c As'],
  ['nothing', 0, '10d 10h 3s 5c As'],
];

test('every poker category settles at the published gross return and records net', () => {
  assert.deepEqual(POKER_PAYTABLE.map(({ category, payoutMultiplier }) => [category, payoutMultiplier]),
    payingHands.map(([category, multiplier]) => [category, multiplier]));
  const stake = 5;
  for (const [category, multiplier, notation] of payingHands) {
    assert.equal(scorePokerHand(cards(notation)), category);
    let state = startVideoPoker(createSession(), stake, orderedDraws(notation));
    for (let index = 0; index < 5; index += 1) state = togglePokerHold(state, index);
    const settled = drawVideoPoker(state);
    const payout = stake * multiplier;
    const net = payout - stake;
    const status = multiplier > 1 ? 'win' : multiplier === 1 ? 'push' : 'loss';
    assert.deepEqual(settled.videoPoker.cards, cards(notation));
    assert.deepEqual(settled.videoPoker.deck, []);
    assert.equal(settled.videoPoker.category, category);
    assert.equal(settled.videoPoker.status, status);
    assert.equal(settled.videoPoker.payout, payout);
    assert.equal(settled.videoPoker.net, net);
    assert.equal(settled.balance, START_BALANCE + net);
    assert.deepEqual(settled.stats, { rounds: 1, wagered: stake, returned: payout });
    const { label } = POKER_PAYTABLE.find((row) => row.category === category);
    assert.deepEqual(settled.history, [{ id: 1, game: 'videoPoker', label, stake, payout, net, status }]);
    assert.deepEqual(loadSession(saveSession(settled)), settled);
    assert.throws(() => drawVideoPoker(settled), /Deal a poker hand/);
  }
});

test('poker distinguishes ace-low straights, high pairs, and invalid or nonpaying hands', () => {
  assert.equal(scorePokerHand(cards('4d 2h Ac 3s 5c')), 'straight');
  assert.equal(scorePokerHand(cards('Qd Kh As 2c 3s')), 'nothing');
  for (const rank of ['J', 'Q', 'K', 'A']) {
    assert.equal(scorePokerHand(cards(`${rank}d ${rank}h 2s 4c 6s`)), 'jacks-or-better');
  }
  assert.throws(() => scorePokerHand(cards('2d 2d 4c 5h As')), /five distinct cards/);
  assert.throws(() => scorePokerHand(cards('2d 3d 4c As')), /five distinct cards/);
  assert.throws(() => scorePokerHand(cards('2d 3d 4c 5h Xs')), /five distinct cards/);
  assert.throws(() => scorePokerHand(Array(5)), /five distinct cards/);
});

test('poker holds and the saved deck survive reload and settle only once', () => {
  const started = startVideoPoker(createSession(), 10, orderedDraws('Js Jh 2d 3s 4c Jd Jc 5d'));
  assert.deepEqual(started.videoPoker.cards, cards('Js Jh 2d 3s 4c'));
  assert.equal(started.videoPoker.deck.length, 47);
  assert.equal(started.balance, 990);
  assert.equal(started.stats.rounds, 0);
  assert.equal(started.history.length, 0);
  assert.throws(() => startVideoPoker(started, 10), /current poker hand/);
  for (const index of [-1, 5, 0.5, '0']) {
    assert.throws(() => togglePokerHold(started, index), /one of the five cards/);
  }

  let held = togglePokerHold(togglePokerHold(started, 0), 1);
  held = togglePokerHold(togglePokerHold(held, 2), 2);
  assert.deepEqual(started.videoPoker.held, [false, false, false, false, false]);
  const loaded = loadSession(saveSession(held));
  assert.deepEqual(loaded, held);
  const settled = drawVideoPoker(loaded);
  assert.deepEqual(settled.videoPoker.cards, cards('Js Jh Jd Jc 5d'));
  assert.equal(settled.videoPoker.category, 'four-of-a-kind');
  assert.equal(settled.videoPoker.payout, 250);
  assert.equal(settled.balance, 1240);
  assert.equal(loaded.videoPoker.deck.length, 47);
  assert.equal(loaded.videoPoker.status, 'playing');
  assert.throws(() => togglePokerHold(settled, 0), /Deal a poker hand/);

  const redeal = startVideoPoker(settled, 10, orderedDraws('Js Jh 2d 3s 4c'));
  assert.deepEqual(redeal.videoPoker.cards, started.videoPoker.cards);
  assert.equal(redeal.videoPoker.deck.length, 47);
});

test('a hand can draw all five replacements without reusing discards', () => {
  const dealt = startVideoPoker(createSession(), 1, orderedDraws('2c 3d 4h 5s 7h 8c 9d 10h Js Qs'));
  const final = drawVideoPoker(dealt);
  assert.deepEqual(final.videoPoker.cards, cards('8c 9d 10h Js Qs'));
  assert.equal(final.videoPoker.category, 'straight');
});

test('poker validates affordable whole wagers and ignores a failed shuffle', () => {
  const session = createSession();
  for (const stake of [0, MAX_BET + 1, 2.5, -1, Infinity, '5']) {
    assert.throws(() => startVideoPoker(session, stake), /whole wager/);
  }
  assert.throws(() => startVideoPoker({ ...session, balance: 1 }, 2), /too low/);
  assert.throws(() => startVideoPoker(session, 20, (max) => max), /invalid result/);
  assert.equal(session.balance, START_BALANCE);
  assert.equal(session.videoPoker, null);
});

test('legacy blackjack sessions migrate, and both live stakes survive reload', () => {
  const blackjack = startBlackjack(createSession(), 40, orderedDraws('10c 9c 8c 7c Ac'));
  const { videoPoker, ...oldState } = blackjack;
  assert.equal(videoPoker, null);
  const migrated = loadSession(JSON.stringify({ ...oldState, version: 1 }));
  assert.deepEqual(migrated, blackjack);

  let state = startVideoPoker(migrated, 20, orderedDraws('Js Jh 2d 3s 4c Jd Jc 5d'));
  state = togglePokerHold(togglePokerHold(state, 0), 1);
  state = rollDice(state, 10, 'seven', (max) => max - 1);
  assert.equal(state.balance, 930);
  assert.equal(state.blackjack.status, 'playing');
  assert.equal(state.videoPoker.status, 'playing');
  assert.deepEqual(loadSession(saveSession(state)), state);
  assert.throws(() => loadSession(saveSession({ ...state, balance: 950 })), /invalid/);

  const pokerFirst = drawVideoPoker(loadSession(saveSession(state)));
  assert.equal(pokerFirst.balance, 1430);
  assert.deepEqual(loadSession(saveSession(pokerFirst)), pokerFirst);
  const bothSettled = standBlackjack(pokerFirst);
  assert.equal(bothSettled.balance, 1510);
  assert.deepEqual(bothSettled.stats, { rounds: 3, wagered: 70, returned: 580 });
  assert.deepEqual(bothSettled.history.map(({ game }) => game), ['blackjack', 'videoPoker', 'dice']);
  assert.deepEqual(loadSession(saveSession(bothSettled)), bothSettled);
});

test('poker save validation checks its deck, holds, result and history', () => {
  const started = startVideoPoker(createSession(), 10, orderedDraws('Js Jh 2d 3s 4c Jd Jc 5d'));
  for (const change of [
    { held: [true, false] },
    { held: [true, false, true, true, 0] },
    { deck: started.videoPoker.deck.slice(1) },
    { deck: [started.videoPoker.cards[0], ...started.videoPoker.deck.slice(1)] },
    { category: 'royal-flush' },
    { payout: 0 },
  ]) {
    assert.throws(() => loadSession(saveSession({
      ...started, videoPoker: { ...started.videoPoker, ...change },
    })), /invalid/);
  }
  const settled = drawVideoPoker(started);
  assert.throws(() => loadSession(saveSession({ ...settled, videoPoker: { ...settled.videoPoker, category: 'full-house' } })), /invalid/);
  assert.throws(() => loadSession(saveSession({ ...settled, history: [{ ...settled.history[0], label: 'Royal flush' }] })), /invalid/);
  assert.throws(() => loadSession(saveSession({ ...settled, version: 1 })), /invalid/);
});
