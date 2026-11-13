import {
  CURRENCY, START_BALANCE, MIN_BET, MAX_BET, DICE_BETS, ROULETTE_WHEEL, createSession, loadSession,
  saveSession, scoreHand, startBlackjack, hitBlackjack, standBlackjack, doubleBlackjack,
  canDoubleBlackjack, spinRoulette, rouletteColor, rollDice,
} from './casino.mjs';
import { SYNERGY_NETWORK, checkSynergyNetwork } from './synergy.mjs';

const byId = (id) => document.getElementById(id);
const storageKey = 'synergy-casino.practice.v1';
const amount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const snrg = (value) => `${amount.format(value)} ${CURRENCY}`;
const signed = (value) => value > 0 ? `+${snrg(value)}` : value < 0 ? `−${snrg(-value)}` : snrg(0);
const suits = { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦' };
const resultNames = { playing: 'Your move', win: 'You win', loss: 'House wins', push: 'Push', blackjack: 'Blackjack!' };
const rouletteBets = { red: 'Red', black: 'Black', odd: 'Odd', even: 'Even', number: 'Exact number' };
const tableInfo = {
  blackjack: {
    title: 'Blackjack',
    intro: 'Beat the dealer’s hand without going over 21.',
    action: 'Deal cards',
    rules: [
      'Face cards count as 10. An ace counts as 1 or 11, whichever makes the best hand without busting.',
      'Hit to draw a card or stand to keep your total. Doubling adds a second stake, draws one card, and ends your turn.',
      'The dealer stands on all 17s. A two-card blackjack pays 3:2, a regular win pays 1:1, and a tie returns the stake. Two opening blackjacks are a tie.',
    ],
  },
  roulette: {
    title: 'Roulette',
    intro: 'Pick a color, parity, or number on the single-zero wheel.',
    action: 'Spin wheel',
    rules: [
      'The European wheel has 37 equally likely pockets from 0 to 36.',
      'Red, black, odd, and even wins pay 1:1. Zero is green and loses on those four bets.',
      'A winning exact-number bet, including zero, pays 35:1.',
    ],
  },
  dice: {
    title: 'Dice',
    intro: 'Predict the total of two six-sided dice.',
    action: 'Roll dice',
    rules: [
      'Low covers totals 2–6. High covers totals 8–12. Both pay 1:1.',
      'An exact total of seven pays 4:1 and loses on low and high.',
    ],
  },
};

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function button(text, className, id, handler) {
  const item = node('button', className, text);
  item.type = 'button';
  if (id) item.id = id;
  if (handler) item.addEventListener('click', handler);
  return item;
}

function restore() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return loadSession(saved);
  } catch {
    // An unavailable or invalid save can be replaced by a fresh practice session.
  }
  return createSession();
}

function persist() {
  try {
    localStorage.setItem(storageKey, saveSession(state));
  } catch {
    // A browser with storage disabled can still play for this page session.
  }
}

let state = restore();
let route = 'lobby';
let rouletteBet = 'red';
let rouletteNumber = 0;
let diceBet = 'low';
let notice = '';
let error = false;
const stakes = { blackjack: '25', roulette: '25', dice: '25' };

function navigate(focus = false) {
  const hash = location.hash.slice(1);
  const previous = route;
  route = Object.hasOwn(tableInfo, hash) ? hash : 'lobby';
  byId('lobby').hidden = route !== 'lobby';
  byId('table-view').hidden = route === 'lobby';
  document.querySelectorAll('[data-route]').forEach((link) => {
    if (link.dataset.route === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (route !== previous) {
    notice = '';
    error = false;
  }
  render();
  if (focus && hash !== 'tables') {
    window.scrollTo(0, 0);
    if (route !== 'lobby') byId('table-title').focus({ preventScroll: true });
  }
}

function setNotice(message, isError = false) {
  notice = message;
  error = isError;
  byId('table-notice').textContent = message;
  byId('table-notice').classList.toggle('error', isError);
}

function play(action, nextFocus, animateSelector) {
  const previouslyFocused = byId('controls').contains(document.activeElement);
  try {
    state = action(state);
    const result = state[route];
    const status = result?.status === 'playing'
      ? (canDoubleBlackjack(state) ? 'Choose hit, stand, or double down.' : 'Choose hit or stand.')
      : `${resultNames[result.status]}. ${snrg(result.payout)} returned.`;
    setNotice(status);
    persist();
    render();
    if (animateSelector) animate(animateSelector);
    if (previouslyFocused) (byId(nextFocus) ?? byId('wager'))?.focus({ preventScroll: true });
  } catch (issue) {
    setNotice(issue.message, true);
    if (byId('wager')?.validity.valid === false) byId('wager').focus();
  }
}

function showCard(card, hide = false) {
  const item = node('div', 'card-face');
  if (hide || !card) {
    item.classList.add(hide ? 'card-back' : 'card-placeholder');
    item.setAttribute('aria-label', hide ? 'Face-down card' : 'Empty card slot');
    item.append(node('span', 'suit', hide ? '♠' : '◇'));
  } else {
    if (['hearts', 'diamonds'].includes(card.suit)) item.classList.add('red');
    item.setAttribute('aria-label', `${card.rank} of ${card.suit}`);
    item.append(node('span', 'rank', card.rank), node('span', 'suit', suits[card.suit]));
  }
  item.setAttribute('role', 'img');
  for (const child of item.children) child.setAttribute('aria-hidden', 'true');
  return item;
}

function showHand(label, cards, hideDealer = false) {
  const group = node('div', 'hand');
  const visible = hideDealer ? cards.slice(0, 1) : cards;
  const title = visible.length ? `${label} · ${scoreHand(visible).total}${hideDealer ? ' showing' : ''}` : label;
  const faces = node('div', 'cards');
  if (cards.length) faces.append(...cards.map((card, index) => showCard(card, hideDealer && index > 0)));
  else faces.append(showCard(), showCard());
  group.append(node('div', 'hand-label', title), faces);
  return group;
}

function resultBlock(result, title, waiting) {
  const block = node('div', 'round-result');
  if (!result || result.status === 'playing') {
    block.append(node('strong', '', waiting));
  } else {
    const message = title ? `${title} · ${resultNames[result.status]}` : resultNames[result.status];
    block.append(
      node('strong', '', message),
      node('span', result.net > 0 ? 'positive' : result.net < 0 ? 'negative' : '', `${signed(result.net)} net · ${snrg(result.payout)} returned`),
    );
  }
  return block;
}

function blackjackStage() {
  const hand = state.blackjack;
  return [
    showHand('Dealer', hand?.dealer ?? [], hand?.status === 'playing'),
    resultBlock(hand, '', hand?.status === 'playing' ? 'Your move' : 'Place a bet to deal'),
    showHand('Your hand', hand?.player ?? []),
  ];
}

function rouletteStage() {
  const result = state.roulette;
  const wheel = node('div', 'wheel-wrap');
  wheel.setAttribute('aria-hidden', 'true');
  const pointer = node('span', 'wheel-pointer');
  const disc = node('div', 'wheel-disc');
  const step = 360 / ROULETTE_WHEEL.length;
  const index = result ? ROULETTE_WHEEL.indexOf(result.number) : 0;
  const rotation = -index * step;
  const palette = { green: '#267955', red: '#a13b37', black: '#202624' };
  const segments = ROULETTE_WHEEL.map((pocket, i) => `${palette[rouletteColor(pocket)]} ${i * step}deg ${(i + 1) * step}deg`);
  disc.style.background = `conic-gradient(from ${-step / 2}deg, ${segments.join(', ')})`;
  disc.style.transform = `rotate(${rotation}deg)`;
  disc.dataset.rotation = rotation;
  ROULETTE_WHEEL.forEach((pocket, i) => {
    const angle = i * step;
    const digit = node('span', 'pocket-number', pocket);
    digit.style.setProperty('--angle', `${angle}deg`);
    digit.style.setProperty('--counter', `${-angle - rotation}deg`);
    disc.append(digit);
  });
  wheel.append(disc, pointer);
  const color = result ? result.color[0].toUpperCase() + result.color.slice(1) : '';
  return [node('div', 'stage-label', 'Single-zero wheel'), wheel, resultBlock(result, result && `${result.number} ${color}`, 'Ready to spin')];
}

const pips = [[], [5], [1, 9], [1, 5, 9], [1, 3, 7, 9], [1, 3, 5, 7, 9], [1, 3, 4, 6, 7, 9]];
function diceStage() {
  const result = state.dice;
  const tray = node('div', 'dice-tray');
  tray.setAttribute('role', 'img');
  tray.setAttribute('aria-label', result ? `Dice show ${result.dice.join(' and ')}` : 'Two dice ready to roll');
  for (const face of result?.dice ?? [1, 1]) {
    const die = node('div', 'die');
    die.setAttribute('aria-hidden', 'true');
    for (const place of pips[face]) {
      const pip = node('span', 'pip');
      pip.style.gridArea = `${Math.ceil(place / 3)} / ${(place - 1) % 3 + 1}`;
      die.append(pip);
    }
    tray.append(die);
  }
  return [node('div', 'stage-label', 'Two dice'), tray, resultBlock(result, result && `Total ${result.sum}`, 'Ready to roll')];
}

function animate(selector) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const item = document.querySelector(selector);
  if (selector === '.wheel-disc') {
    const end = Number(item.dataset.rotation);
    item.animate([{ transform: `rotate(${end - 740}deg)` }, { transform: `rotate(${end}deg)` }],
      { duration: 780, easing: 'cubic-bezier(.1,.6,.16,1)' });
  } else {
    item.animate([{ transform: 'translateY(-8px) scale(.95)' }, { transform: 'translateY(0) scale(1)' }],
      { duration: 260, easing: 'ease-out' });
  }
}

function makeStakeField() {
  const group = node('div', 'control-group');
  const label = node('label', '', 'Wager');
  label.htmlFor = 'wager';
  const row = node('div', 'stake-row');
  const input = node('input', 'stake-field');
  Object.assign(input, { id: 'wager', type: 'number', min: MIN_BET, max: MAX_BET, step: 1, required: true, value: stakes[route] });
  input.inputMode = 'numeric';
  const currency = node('span', '', CURRENCY);
  currency.id = 'wager-unit';
  input.setAttribute('aria-describedby', currency.id);
  row.append(input, currency);
  const quick = node('div', 'quick-bets');
  const syncChips = () => quick.querySelectorAll('button').forEach((chip) => {
    chip.setAttribute('aria-pressed', String(Number(chip.dataset.stake) === Number(input.value)));
  });
  [10, 25, 50, 100].forEach((value) => {
    const chip = button(String(value), 'quick-bet', '', () => {
      input.value = value;
      stakes[route] = input.value;
      syncChips();
    });
    chip.dataset.stake = value;
    chip.setAttribute('aria-label', `Set wager to ${snrg(value)}`);
    quick.append(chip);
  });
  input.addEventListener('input', () => {
    stakes[route] = input.value;
    syncChips();
  });
  syncChips();
  group.append(label, row, quick);
  return { group, input };
}

function makeChoices(choices, selected, choose) {
  const group = node('div', 'control-group');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Bet type');
  group.append(node('div', 'control-legend', 'Bet on'));
  const row = node('div', 'choice-row');
  for (const [id, label, odds] of choices) {
    const pick = button(label, 'choice', `pick-${id}`, () => {
      choose(id);
      row.querySelectorAll('button').forEach((other) => other.setAttribute('aria-pressed', String(other === pick)));
    });
    pick.append(node('span', '', odds));
    pick.setAttribute('aria-pressed', String(id === selected));
    row.append(pick);
  }
  group.append(row);
  return group;
}

function makeRouletteChoices() {
  const numberGroup = node('div', 'control-group');
  const label = node('label', '', 'Pocket');
  label.htmlFor = 'roulette-number';
  const select = node('select', 'number-select');
  select.id = 'roulette-number';
  for (let i = 0; i <= 36; i += 1) {
    const option = node('option', '', `${i} · ${rouletteColor(i)}`);
    option.value = i;
    select.append(option);
  }
  select.value = rouletteNumber;
  select.addEventListener('change', () => { rouletteNumber = Number(select.value); });
  numberGroup.append(label, select);
  numberGroup.hidden = rouletteBet !== 'number';
  const choices = Object.entries(rouletteBets).map(([id, labelText]) => [id, labelText, id === 'number' ? '35:1' : '1:1']);
  return [makeChoices(choices, rouletteBet, (id) => {
    rouletteBet = id;
    numberGroup.hidden = id !== 'number';
  }), numberGroup];
}

function activeHandControls() {
  const container = node('div');
  const row = node('div', 'action-row');
  row.append(
    button('Hit', 'gold-button', 'hit', () => play(hitBlackjack, 'hit')),
    button('Stand', 'outline-button', 'stand', () => play(standBlackjack, 'wager')),
  );
  const double = button('Double', 'outline-button', 'double', () => play(doubleBlackjack, 'wager'));
  double.disabled = !canDoubleBlackjack(state);
  row.append(double);
  container.append(node('p', 'hint', `${snrg(state.blackjack.stake)} in play.`), row);
  return container;
}

function wagerControls() {
  const form = node('form');
  const { group, input } = makeStakeField();
  form.append(group);
  if (route === 'roulette') form.append(...makeRouletteChoices());
  if (route === 'dice') {
    const choices = Object.entries(DICE_BETS).map(([id, bet]) => [
      id, bet.min === bet.max ? `${bet.label} · 7` : `${bet.label} · ${bet.min}–${bet.max}`, bet.odds,
    ]);
    form.append(makeChoices(choices, diceBet, (id) => { diceBet = id; }));
  }
  const submit = node('button', 'gold-button bet-submit', tableInfo[route].action);
  submit.type = 'submit';
  submit.disabled = state.balance < MIN_BET;
  form.append(submit);
  const hint = state.balance < MIN_BET
    ? 'Balance below the minimum. Reset your practice session to keep playing.'
    : `Available ${snrg(state.balance)} · Wager ${MIN_BET}–${MAX_BET} ${CURRENCY}`;
  form.append(node('p', 'hint', hint));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const stake = Number(input.value);
    if (route === 'blackjack') play((current) => startBlackjack(current, stake), 'hit');
    if (route === 'roulette') play((current) => spinRoulette(current, stake,
      rouletteBet === 'number' ? { type: rouletteBet, number: rouletteNumber } : { type: rouletteBet }), 'wager', '.wheel-disc');
    if (route === 'dice') play((current) => rollDice(current, stake, diceBet), 'wager', '.dice-tray');
  });
  return form;
}

function render() {
  byId('header-balance').textContent = snrg(state.balance);
  if (route === 'lobby') return;
  byId('table-title').textContent = tableInfo[route].title;
  byId('table-intro').textContent = tableInfo[route].intro;
  const stage = byId('game-stage');
  stage.className = `game-stage ${route}-stage`;
  const buildStage = { blackjack: blackjackStage, roulette: rouletteStage, dice: diceStage };
  stage.replaceChildren(...buildStage[route]());
  const activeHand = route === 'blackjack' && state.blackjack?.status === 'playing';
  byId('controls-title').textContent = activeHand ? 'Your move' : 'Place your bet';
  byId('controls').replaceChildren(activeHand ? activeHandControls() : wagerControls());
  setNotice(notice, error);
}

function showRules() {
  const content = byId('rules-content');
  byId('rules-title').textContent = `${tableInfo[route].title} rules`;
  const list = node('ul');
  list.append(...tableInfo[route].rules.map((rule) => node('li', '', rule)));
  content.replaceChildren(list);
  byId('rules-dialog').showModal();
}

function showSession() {
  const stats = node('div', 'stats-grid');
  [
    ['Available', snrg(state.balance)],
    ['Settled wagers', amount.format(state.stats.rounds)],
    ['Session net', signed(state.stats.returned - state.stats.wagered)],
  ].forEach(([name, value]) => {
    const stat = node('div', 'stat');
    stat.append(node('span', '', name), node('strong', '', value));
    stats.append(stat);
  });
  const list = node('ol', 'history-list');
  for (const entry of state.history) {
    const row = node('li');
    const description = node('div');
    description.append(node('strong', '', tableInfo[entry.game].title), node('span', '', entry.label));
    const funds = node('div');
    funds.append(node('strong', entry.net > 0 ? 'positive' : entry.net < 0 ? 'negative' : '', signed(entry.net)),
      node('span', '', `${snrg(entry.stake)} wager`));
    row.append(description, funds);
    list.append(row);
  }
  const history = state.history.length ? list : node('p', 'session-empty', 'Settled wagers will appear here.');
  const content = byId('session-content');
  content.replaceChildren(stats);
  if (state.blackjack?.status === 'playing') content.append(node('p', '', `Blackjack hand in progress · ${snrg(state.blackjack.stake)} reserved`));
  content.append(history);
  byId('session-dialog').showModal();
}

document.querySelectorAll('[data-close]').forEach((item) => {
  item.addEventListener('click', () => item.closest('dialog').close());
});
byId('show-rules').addEventListener('click', showRules);
byId('show-session').addEventListener('click', showSession);
byId('show-reset').addEventListener('click', () => {
  byId('session-dialog').close();
  byId('reset-dialog').showModal();
});
byId('reset-session').addEventListener('click', () => {
  state = createSession();
  persist();
  setNotice(`Practice session reset to ${snrg(START_BALANCE)}.`);
  render();
  byId('reset-dialog').close();
  byId('show-session').focus({ preventScroll: true });
});
byId('show-network').addEventListener('click', () => byId('network-dialog').showModal());
byId('chain-id').textContent = SYNERGY_NETWORK.chainId;
byId('chain-currency').textContent = SYNERGY_NETWORK.currency;
byId('check-network').addEventListener('click', async (event) => {
  const trigger = event.currentTarget;
  trigger.disabled = true;
  byId('network-status').textContent = 'Checking…';
  const result = await checkSynergyNetwork();
  byId('network-status').textContent = result.message;
  document.querySelector('.network-dot').classList.toggle('verified', result.status === 'verified');
  trigger.disabled = false;
});
window.addEventListener('hashchange', () => navigate(true));
navigate();
