const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const $ = id => document.getElementById(id);

let coins = 0;
let energy = 500;
let maxEnergy = 500;
let tapPower = 1;
let tapLevel = 0;

function update() {
  $('coins').textContent = coins.toLocaleString('ru-RU');
  $('energy').textContent = energy;
  $('maxEnergy').textContent = maxEnergy;
  $('energyBar').style.width = (energy / maxEnergy * 100) + '%';
  $('energyCost').textContent = 'Цена: 100 COIN';
  $('tapDescription').textContent = `Сейчас: +${tapPower} COIN за тап`;

  const costs = [500, 1500, 5000, 15000];
  $('tapCost').textContent = tapLevel >= 4
    ? 'Максимальный уровень'
    : `Следующий уровень: ${costs[tapLevel]} COIN`;

  $('buyTap').disabled = tapLevel >= 4;
  $('buyEnergy').disabled = coins < 100;
  $('buyTap').disabled = tapLevel >= 4 || coins < costs[tapLevel];
}

$('tap').addEventListener('click', async () => {
  if (energy <= 0) {
    $('notice').textContent = 'Нет энергии! Подожди ⚡';
    return;
  }

  energy--;
  coins += tapPower;
  update();

  if (tg) tg.HapticFeedback?.impactOccurred('light');

  try {
    await fetch('/api/tap', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({count: 1})
    });
  } catch (e) {}
});

$('buyEnergy').addEventListener('click', async () => {
  if (coins < 100) return;
  coins -= 100;
  maxEnergy += 250;
  energy = Math.min(maxEnergy, energy + 250);
  update();
  try {
    await fetch('/api/upgrade/energy', {method:'POST'});
  } catch(e) {}
});

$('buyTap').addEventListener('click', async () => {
  const costs = [500, 1500, 5000, 15000];
  if (tapLevel >= 4 || coins < costs[tapLevel]) return;

  coins -= costs[tapLevel];
  tapLevel++;
  tapPower = [1, 2, 5, 10, 20][tapLevel];
  update();

  try {
    await fetch('/api/upgrade/tap', {method:'POST'});
  } catch(e) {}
});

document.querySelectorAll('.tab').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    button.classList.add('active');

    $('shop').classList.toggle('hidden', button.dataset.tab !== 'shop');
    $('top').classList.toggle('hidden', button.dataset.tab !== 'top');
    document.querySelector('.coin-area').classList.toggle('hidden', button.dataset.tab !== 'home');
    document.querySelector('.balance').classList.toggle('hidden', button.dataset.tab !== 'home');
    $('energy').closest('.energy').classList.toggle('hidden', button.dataset.tab !== 'home');
  });
});

setInterval(() => {
  if (energy < maxEnergy) {
    energy++;
    update();
  }
}, 5000);

async function loadLeaderboard() {
  try {
    const response = await fetch('/api/leaderboard');
    const data = await response.json();
    $('leaders').innerHTML = data.map((p, i) =>
      `<p>${i + 1}. ${p.username || 'Игрок'} — ${p.coins} COIN</p>`
    ).join('') || 'Пока нет игроков';
  } catch (e) {
    $('leaders').textContent = 'Топ появится после запуска игры';
  }
}

loadLeaderboard();
update();
