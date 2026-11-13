export const CURRENCY = 'SNRG';
export const START_BALANCE = 1000;
export const MIN_BET = 1;
export const MAX_BET = 500;

const VERSION = 2;
const LEGACY_VERSION = 1;
const HISTORY_LIMIT = 30;
const SHOE_CUT = 26;
const UINT32_RANGE = 2 ** 32;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const CARD_VALUES = Object.freeze({
  A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 10, Q: 10, K: 10,
});
const SETTLED_STATUS = ['win', 'loss', 'push', 'blackjack'];
const BET_TYPES = ['red', 'black', 'odd', 'even', 'number'];
const RED_POCKETS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export const ROULETTE_WHEEL = Object.freeze([
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]);
export const DICE_BETS = Object.freeze({
  low: Object.freeze({ label: 'Low', odds: '1:1', min: 2, max: 6, payoutMultiplier: 2 }),
  high: Object.freeze({ label: 'High', odds: '1:1', min: 8, max: 12, payoutMultiplier: 2 }),
  seven: Object.freeze({ label: 'Seven', odds: '4:1', min: 7, max: 7, payoutMultiplier: 5 }),
});

// Gross returns include the stake. This paytable applies at every stake size.
export const POKER_PAYTABLE = Object.freeze([
  ['royal-flush', 'Royal flush', 800],
  ['straight-flush', 'Straight flush', 50],
  ['four-of-a-kind', 'Four of a kind', 25],
  ['full-house', 'Full house', 9],
  ['flush', 'Flush', 6],
  ['straight', 'Straight', 4],
  ['three-of-a-kind', 'Three of a kind', 3],
  ['two-pair', 'Two pair', 2],
  ['jacks-or-better', 'Jacks or better', 1],
  ['nothing', 'No paying hand', 0],
].map(([category, label, payoutMultiplier]) => Object.freeze({ category, label, payoutMultiplier })));
const POKER_RESULTS = Object.fromEntries(POKER_PAYTABLE.map((result) => [result.category, result]));

function integerBetween(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

export function secureRandomInt(max) {
  if (!integerBetween(max, 1, UINT32_RANGE)) throw new Error('The random range is invalid.');
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) throw new Error('Secure random numbers are unavailable in this browser.');
  const limit = UINT32_RANGE - (UINT32_RANGE % max);
  const sample = new Uint32Array(1);
  do {
    crypto.getRandomValues(sample);
  } while (sample[0] >= limit);
  return sample[0] % max;
}

function sampleInt(randomInt, max) {
  const sample = randomInt(max);
  if (!integerBetween(sample, 0, max - 1)) throw new Error('The random source returned an invalid result.');
  return sample;
}

function makeShoe(randomInt) {
  const cards = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const other = sampleInt(randomInt, index + 1);
    [cards[index], cards[other]] = [cards[other], cards[index]];
  }
  return cards;
}

export function createSession() {
  return {
    version: VERSION,
    balance: START_BALANCE,
    blackjack: null,
    videoPoker: null,
    roulette: null,
    dice: null,
    shoe: [],
    history: [],
    stats: { rounds: 0, wagered: 0, returned: 0 },
  };
}

function currencyAmount(value) {
  return typeof value === 'number' && value >= 0 && Number.isSafeInteger(value * 2);
}

function takeStake(state, stake) {
  if (!integerBetween(stake, MIN_BET, MAX_BET)) {
    throw new Error(`Enter a whole wager from ${MIN_BET} to ${MAX_BET} ${CURRENCY}.`);
  }
  if (stake > state.balance) throw new Error('Your balance is too low for that wager.');
  return { ...state, balance: state.balance - stake };
}

function settle(state, game, result, label) {
  const { stake, payout, status } = result;
  const stats = {
    rounds: state.stats.rounds + 1,
    wagered: state.stats.wagered + stake,
    returned: state.stats.returned + payout,
  };
  const balance = state.balance + payout;
  if (!Number.isSafeInteger(stats.rounds) || !currencyAmount(stats.wagered)
    || !currencyAmount(stats.returned) || !currencyAmount(balance)) {
    throw new Error('This session reached its balance limit. Start a new session to keep playing.');
  }
  const net = payout - stake;
  const entry = { id: stats.rounds, game, label, stake, payout, net, status };
  return {
    ...state,
    [game]: { ...result, net },
    balance,
    stats,
    history: [entry, ...state.history].slice(0, HISTORY_LIMIT),
  };
}

export function scoreHand(cards) {
  let total = 0;
  let hasAce = false;
  for (const { rank } of cards) {
    if (!RANKS.includes(rank)) throw new Error('The hand contains an invalid card.');
    total += CARD_VALUES[rank];
    if (rank === 'A') hasAce = true;
  }
  const soft = hasAce && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}

function draw(shoe) {
  const card = shoe.pop();
  if (!card) throw new Error('The deck ran out of cards.');
  return card;
}

function finishBlackjack(state, status) {
  const hand = state.blackjack;
  const multipliers = { loss: 0, push: 1, win: 2, blackjack: 2.5 };
  const playerTotal = scoreHand(hand.player).total;
  const dealerTotal = scoreHand(hand.dealer).total;
  const label = status === 'blackjack' ? 'Blackjack' : `Player ${playerTotal} · Dealer ${dealerTotal}`;
  return settle(state, 'blackjack', { ...hand, status, payout: hand.stake * multipliers[status] }, label);
}

export function startBlackjack(state, stake, randomInt = secureRandomInt) {
  if (state.blackjack?.status === 'playing') throw new Error('Finish the current blackjack hand first.');
  const next = takeStake(state, stake);
  next.shoe = next.shoe.length < SHOE_CUT ? makeShoe(randomInt) : [...next.shoe];
  const player = [draw(next.shoe)];
  const dealer = [draw(next.shoe)];
  player.push(draw(next.shoe));
  dealer.push(draw(next.shoe));
  next.blackjack = { player, dealer, stake, status: 'playing', payout: null, net: null };
  const playerNatural = scoreHand(player).total === 21;
  const dealerNatural = scoreHand(dealer).total === 21;
  if (playerNatural && dealerNatural) return finishBlackjack(next, 'push');
  if (playerNatural) return finishBlackjack(next, 'blackjack');
  if (dealerNatural) return finishBlackjack(next, 'loss');
  return next;
}

function activeHand(state) {
  if (state.blackjack?.status !== 'playing') throw new Error('Deal a blackjack hand first.');
  return {
    ...state,
    shoe: [...state.shoe],
    blackjack: {
      ...state.blackjack,
      player: [...state.blackjack.player],
      dealer: [...state.blackjack.dealer],
    },
  };
}

function dealerPlays(state) {
  const { player, dealer } = state.blackjack;
  const playerTotal = scoreHand(player).total;
  if (playerTotal > 21) return finishBlackjack(state, 'loss');
  let dealerTotal = scoreHand(dealer).total;
  while (dealerTotal < 17) {
    dealer.push(draw(state.shoe));
    dealerTotal = scoreHand(dealer).total;
  }
  if (dealerTotal > 21 || playerTotal > dealerTotal) return finishBlackjack(state, 'win');
  return finishBlackjack(state, playerTotal === dealerTotal ? 'push' : 'loss');
}

export function hitBlackjack(state) {
  const next = activeHand(state);
  next.blackjack.player.push(draw(next.shoe));
  const total = scoreHand(next.blackjack.player).total;
  if (total > 21) return finishBlackjack(next, 'loss');
  if (total === 21) return dealerPlays(next);
  return next;
}

export function standBlackjack(state) {
  return dealerPlays(activeHand(state));
}

export function canDoubleBlackjack(state) {
  const hand = state.blackjack;
  return hand?.status === 'playing' && hand.player.length === 2 && state.balance >= hand.stake;
}

export function doubleBlackjack(state) {
  if (!canDoubleBlackjack(state)) throw new Error('Double down on your first two cards when you can cover the additional wager.');
  const next = activeHand(state);
  next.balance -= next.blackjack.stake;
  next.blackjack.stake *= 2;
  next.blackjack.player.push(draw(next.shoe));
  return dealerPlays(next);
}

export function scorePokerHand(cards) {
  if (!validPokerCards(cards)) throw new Error('A poker hand must contain five distinct cards.');

  const ranks = cards.map(({ rank }) => rank === 'A' ? 14 : RANKS.indexOf(rank) + 1).sort((a, b) => a - b);
  const counts = new Map();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.values()].sort((a, b) => b - a);
  const [low, , , fourth, high] = ranks;
  const flush = cards.every(({ suit }) => suit === cards[0].suit);
  const aceLow = low === 2 && fourth === 5 && high === 14;
  const straight = counts.size === 5 && (high - low === 4 || aceLow);

  if (flush && straight) return low === 10 ? 'royal-flush' : 'straight-flush';
  if (groups[0] === 4) return 'four-of-a-kind';
  if (groups[0] === 3 && groups[1] === 2) return 'full-house';
  if (flush) return 'flush';
  if (straight) return 'straight';
  if (groups[0] === 3) return 'three-of-a-kind';
  if (groups[0] === 2 && groups[1] === 2) return 'two-pair';
  if ([...counts].some(([rank, count]) => rank >= 11 && count === 2)) return 'jacks-or-better';
  return 'nothing';
}

export function startVideoPoker(state, stake, randomInt = secureRandomInt) {
  if (state.videoPoker?.status === 'playing') throw new Error('Finish the current poker hand first.');
  const next = takeStake(state, stake);
  const deck = makeShoe(randomInt);
  const cards = Array.from({ length: 5 }, () => draw(deck));
  next.videoPoker = {
    cards, held: [false, false, false, false, false], stake, status: 'playing',
    category: null, payout: null, net: null, deck,
  };
  return next;
}

function activePokerHand(state) {
  if (state.videoPoker?.status !== 'playing') throw new Error('Deal a poker hand first.');
  return state.videoPoker;
}

export function togglePokerHold(state, cardIndex) {
  const hand = activePokerHand(state);
  if (!integerBetween(cardIndex, 0, hand.cards.length - 1)) throw new Error('Choose one of the five cards to hold.');
  const held = [...hand.held];
  held[cardIndex] = !held[cardIndex];
  return { ...state, videoPoker: { ...hand, held } };
}

function pokerStatus(multiplier) {
  if (multiplier === 0) return 'loss';
  if (multiplier === 1) return 'push';
  return 'win';
}

export function drawVideoPoker(state) {
  const hand = activePokerHand(state);
  const deck = [...hand.deck];
  const cards = hand.cards.map((card, index) => hand.held[index] ? card : draw(deck));
  const category = scorePokerHand(cards);
  const { label, payoutMultiplier } = POKER_RESULTS[category];
  const payout = hand.stake * payoutMultiplier;
  const status = pokerStatus(payoutMultiplier);
  return settle(state, 'videoPoker', { ...hand, cards, category, payout, status, deck: [] }, label);
}

export function rouletteColor(number) {
  if (!integerBetween(number, 0, 36)) throw new Error('The roulette pocket must be between 0 and 36.');
  if (number === 0) return 'green';
  return RED_POCKETS.has(number) ? 'red' : 'black';
}

function rouletteMultiplier(bet, number) {
  if (bet.type === 'number') return bet.number === number ? 36 : 0;
  if (number === 0) return 0;
  if (bet.type === 'odd') return number % 2 ? 2 : 0;
  if (bet.type === 'even') return number % 2 === 0 ? 2 : 0;
  return rouletteColor(number) === bet.type ? 2 : 0;
}

function validRouletteBet(bet) {
  return isRecord(bet) && BET_TYPES.includes(bet.type)
    && (bet.type === 'number' ? integerBetween(bet.number, 0, 36) : bet.number === undefined);
}

export function spinRoulette(state, stake, bet, randomInt = secureRandomInt) {
  if (!validRouletteBet(bet)) throw new Error('Choose a color, parity, or a number from 0 to 36.');
  const next = takeStake(state, stake);
  const number = sampleInt(randomInt, 37);
  const color = rouletteColor(number);
  const wager = bet.type === 'number' ? { type: bet.type, number: bet.number } : { type: bet.type };
  const payout = stake * rouletteMultiplier(wager, number);
  const status = payout > 0 ? 'win' : 'loss';
  const selection = bet.type === 'number' ? `No. ${bet.number}` : bet.type;
  return settle(next, 'roulette', { number, color, bet: wager, stake, payout, status }, `${selection} · ${number} ${color}`);
}

function diceMultiplier(bet, sum) {
  const { min, max, payoutMultiplier } = DICE_BETS[bet];
  return sum >= min && sum <= max ? payoutMultiplier : 0;
}

function validDiceBet(bet) {
  return typeof bet === 'string' && Object.hasOwn(DICE_BETS, bet);
}

export function rollDice(state, stake, bet, randomInt = secureRandomInt) {
  if (!validDiceBet(bet)) throw new Error('Choose Low, High, or Seven.');
  const next = takeStake(state, stake);
  const dice = [sampleInt(randomInt, 6) + 1, sampleInt(randomInt, 6) + 1];
  const sum = dice[0] + dice[1];
  const payout = stake * diceMultiplier(bet, sum);
  const status = payout > 0 ? 'win' : 'loss';
  return settle(next, 'dice', { dice, sum, bet, stake, payout, status }, `${DICE_BETS[bet].label} · rolled ${sum}`);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validCards(cards) {
  return Array.isArray(cards) && cards.length <= 52
    && cards.every((card) => isRecord(card) && RANKS.includes(card.rank) && SUITS.includes(card.suit));
}

function uniqueCards(cards) {
  return new Set(cards.map(({ rank, suit }) => `${rank} ${suit}`)).size === cards.length;
}

function validPokerCards(cards) {
  return Array.isArray(cards) && cards.length === 5 && validCards([...cards]) && uniqueCards(cards);
}

function validBlackjack(hand, shoe) {
  if (hand === null) return shoe.length === 0;
  if (!isRecord(hand) || !validCards(hand.player) || !validCards(hand.dealer)
    || hand.player.length < 2 || hand.dealer.length < 2 || !uniqueCards([...hand.player, ...hand.dealer, ...shoe])) return false;
  if (hand.status === 'playing') {
    return integerBetween(hand.stake, MIN_BET, MAX_BET) && hand.payout === null && hand.net === null
      && hand.dealer.length === 2 && scoreHand(hand.player).total < 21 && scoreHand(hand.dealer).total < 21 && shoe.length > 0;
  }
  return validSettledWager(hand, 'blackjack');
}

function validSettledWager(result, game) {
  if (!isRecord(result) || !integerBetween(result.stake, MIN_BET, game === 'blackjack' ? MAX_BET * 2 : MAX_BET)
    || !currencyAmount(result.payout) || result.net !== result.payout - result.stake
    || !SETTLED_STATUS.includes(result.status)) return false;
  const multiplier = result.payout / result.stake;
  if (game === 'videoPoker') {
    return result.status === pokerStatus(multiplier)
      && POKER_PAYTABLE.some(({ payoutMultiplier }) => payoutMultiplier === multiplier);
  }
  if (result.status === 'loss') return multiplier === 0;
  if (result.status === 'push') return game === 'blackjack' && multiplier === 1;
  if (result.status === 'blackjack') return game === 'blackjack' && multiplier === 2.5;
  if (game === 'blackjack') return multiplier === 2;
  return multiplier === 2 || multiplier === (game === 'roulette' ? 36 : 5);
}

function validRoulette(result) {
  if (result === null) return true;
  return validSettledWager(result, 'roulette') && integerBetween(result.number, 0, 36)
    && result.color === rouletteColor(result.number) && validRouletteBet(result.bet)
    && result.payout === result.stake * rouletteMultiplier(result.bet, result.number);
}

function validDice(result) {
  if (result === null) return true;
  return validSettledWager(result, 'dice') && validDiceBet(result.bet)
    && Array.isArray(result.dice) && result.dice.length === 2 && result.dice.every((die) => integerBetween(die, 1, 6))
    && result.sum === result.dice[0] + result.dice[1] && result.payout === result.stake * diceMultiplier(result.bet, result.sum);
}

function validVideoPoker(hand) {
  if (hand === null) return true;
  if (!isRecord(hand) || !validPokerCards(hand.cards) || !validCards(hand.deck)
    || !Array.isArray(hand.held) || hand.held.length !== 5
    || !hand.held.every((held) => typeof held === 'boolean')) return false;
  if (hand.status === 'playing') {
    return integerBetween(hand.stake, MIN_BET, MAX_BET) && hand.deck.length === 47
      && uniqueCards([...hand.cards, ...hand.deck])
      && hand.category === null && hand.payout === null && hand.net === null;
  }
  if (hand.deck.length !== 0 || !validSettledWager(hand, 'videoPoker')) return false;
  const category = scorePokerHand(hand.cards);
  return hand.category === category && hand.payout === hand.stake * POKER_RESULTS[category].payoutMultiplier;
}

function pendingStake(hand) {
  return hand?.status === 'playing' ? hand.stake : 0;
}

function validHistoryEntry(entry, expectedId) {
  if (!isRecord(entry) || !['blackjack', 'roulette', 'dice', 'videoPoker'].includes(entry.game)
    || !validSettledWager(entry, entry.game) || entry.id !== expectedId
    || typeof entry.label !== 'string' || entry.label.length > 100) return false;
  return entry.game !== 'videoPoker' || POKER_PAYTABLE.some(({ label, payoutMultiplier }) =>
    entry.label === label && entry.payout === entry.stake * payoutMultiplier);
}

function validAccounting(state) {
  const { stats, history, balance, blackjack, videoPoker } = state;
  if (!isRecord(stats) || !integerBetween(stats.rounds, 0, Number.MAX_SAFE_INTEGER)
    || !currencyAmount(stats.wagered) || !currencyAmount(stats.returned) || !currencyAmount(balance)
    || !Array.isArray(history) || history.length !== Math.min(stats.rounds, HISTORY_LIMIT)) return false;
  const pending = pendingStake(blackjack) + pendingStake(videoPoker);
  if (balance !== START_BALANCE + (stats.returned - stats.wagered) - pending) return false;
  return history.every((entry, index) => validHistoryEntry(entry, stats.rounds - index));
}

export function saveSession(state) {
  return JSON.stringify(state);
}

export function loadSession(json) {
  let state;
  try {
    state = JSON.parse(json);
  } catch {
    throw new Error('This saved session could not be read.');
  }
  if (isRecord(state) && state.version === LEGACY_VERSION && !Object.hasOwn(state, 'videoPoker')
    && Array.isArray(state.history) && !state.history.some((entry) => entry?.game === 'videoPoker')) {
    state = { ...state, version: VERSION, videoPoker: null };
  }
  if (!isRecord(state) || state.version !== VERSION || !validCards(state.shoe)
    || !validBlackjack(state.blackjack, state.shoe) || !validRoulette(state.roulette)
    || !validDice(state.dice) || !validVideoPoker(state.videoPoker) || !validAccounting(state)) {
    throw new Error('This saved session is invalid or uses an unsupported format.');
  }
  return state;
}
