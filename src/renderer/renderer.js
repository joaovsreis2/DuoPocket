'use strict';

const elements = {
  filters: document.querySelector('#filters'),
  sectionTitle: document.querySelector('#section-title'),
  sectionEyebrow: document.querySelector('#section-eyebrow'),
  search: document.querySelector('#search'),
  addFiles: document.querySelector('#add-files'),
  addFolder: document.querySelector('#add-folder'),
  hero: document.querySelector('#hero'),
  grid: document.querySelector('#game-grid'),
  resultCount: document.querySelector('#result-count'),
  dropZone: document.querySelector('#drop-zone'),
  removeDialog: document.querySelector('#remove-dialog'),
  toastRegion: document.querySelector('#toast-region')
};

const FILTERS = {
  all: { title: 'Todos os jogos', eyebrow: 'Biblioteca local', match: () => true },
  recent: { title: 'Jogados recentemente', eyebrow: 'Retomar uma sessão', match: (game) => Boolean(game.lastPlayed) },
  favorites: { title: 'Favoritos', eyebrow: 'Sua seleção', match: (game) => game.favorite },
  gameboy: { title: 'Game Boy', eyebrow: 'GB · GBC · GBA', match: (game) => ['gb', 'gbc', 'gba'].includes(game.system) },
  nds: { title: 'Nintendo DS', eyebrow: 'Duas telas', match: (game) => game.system === 'nds' }
};

const demoGames = [
  { id: 'demo-1', title: 'Aurora Circuit', fileName: 'aurora-circuit.gba', system: 'gba', systemName: 'Game Boy Advance', engine: 'mgba', size: 16777216, palette: ['#3452D1', '#AFC2FF'], favorite: true, available: true, lastPlayed: new Date(Date.now() - 38 * 60000).toISOString(), playCount: 8 },
  { id: 'demo-2', title: 'Pocket Botanica', fileName: 'pocket-botanica.nds', system: 'nds', systemName: 'Nintendo DS', engine: 'melonds', size: 67108864, palette: ['#1D7A72', '#A8DED3'], favorite: false, available: true, lastPlayed: new Date(Date.now() - 86400000).toISOString(), playCount: 3 },
  { id: 'demo-3', title: 'Neon Rally', fileName: 'neon-rally.gbc', system: 'gbc', systemName: 'Game Boy Color', engine: 'mgba', size: 4194304, palette: ['#FA685B', '#FFC4B8'], favorite: false, available: true, lastPlayed: null, playCount: 0 },
  { id: 'demo-4', title: 'Tiny Kingdom', fileName: 'tiny-kingdom.nds', system: 'nds', systemName: 'Nintendo DS', engine: 'melonds', size: 134217728, palette: ['#8052A8', '#D9BDEA'], favorite: true, available: true, lastPlayed: null, playCount: 0 },
  { id: 'demo-5', title: 'Tidebound', fileName: 'tidebound.gb', system: 'gb', systemName: 'Game Boy', engine: 'mgba', size: 1048576, palette: ['#27324C', '#B8C4DB'], favorite: false, available: true, lastPlayed: null, playCount: 0 }
];

const state = {
  games: [],
  emulators: {},
  filter: 'all',
  query: '',
  selectedId: null,
  removeTarget: null,
  busy: false,
  demo: new URLSearchParams(location.search).get('demo') === '1'
};

const PALETTE_INDEX = new Map([
  ['#3452D1', 0],
  ['#FA685B', 1],
  ['#1D7A72', 2],
  ['#8052A8', 3],
  ['#B57221', 4],
  ['#27324C', 5]
]);

function paletteClass(game) {
  return `palette-${PALETTE_INDEX.get(game.palette?.[0]) ?? 0}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'tamanho desconhecido';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function relativeDate(value) {
  if (!value) return 'Ainda não jogado';
  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), 'hour');
  if (Math.abs(seconds) < 2592000) return formatter.format(Math.round(seconds / 86400), 'day');
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(date);
}

function visibleGames() {
  const filter = FILTERS[state.filter];
  const query = state.query.trim().toLocaleLowerCase('pt-BR');
  return state.games
    .filter(filter.match)
    .filter((game) => !query || `${game.title} ${game.fileName} ${game.systemName}`.toLocaleLowerCase('pt-BR').includes(query))
    .sort((a, b) => {
      if (state.filter === 'recent') return new Date(b.lastPlayed) - new Date(a.lastPlayed);
      return a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' });
    });
}

function selectedGame(games = visibleGames()) {
  return games.find((game) => game.id === state.selectedId) || games[0] || null;
}

function consoleMarkup(game) {
  const initials = game.title.split(/\s+/).slice(0, 2).map((word) => word[0]).join('');
  if (game.system === 'nds') {
    return `<div class="console ds ${paletteClass(game)}" aria-hidden="true">
      <div class="top-shell"><div class="screen">${escapeHtml(initials)}</div></div>
      <div class="hinge"></div>
      <div class="bottom-shell"><div class="dpad-mini"></div><div class="screen">${escapeHtml(game.system.toUpperCase())}</div><div class="buttons-mini"></div></div>
    </div>`;
  }
  return `<div class="console gba ${paletteClass(game)}" aria-hidden="true">
    <div class="screen">${escapeHtml(initials)}</div><div class="dpad-mini"></div><div class="buttons-mini"></div>
  </div>`;
}

function renderHero(games) {
  const game = selectedGame(games);
  state.selectedId = game?.id || null;

  if (!game) {
    const isEmptyLibrary = state.games.length === 0;
    elements.hero.innerHTML = `<div class="hero-content">
      <div class="hero-copy hero-empty-copy">
        <p class="eyebrow">${isEmptyLibrary ? 'Sua biblioteca começa aqui' : 'Nenhuma correspondência'}</p>
        <h2>${isEmptyLibrary ? 'Duas gerações.<br>Uma só estante.' : 'Nada nesta prateleira.'}</h2>
        <p>${isEmptyLibrary ? 'Adicione seus backups de Game Boy, Game Boy Color, Game Boy Advance ou Nintendo DS. Os jogos ficam no seu computador.' : 'Altere o filtro ou a pesquisa para encontrar outro jogo da biblioteca.'}</p>
        ${isEmptyLibrary ? '<button class="primary-button" data-action="add"><svg><use href="#i-plus"></use></svg>Adicionar meus jogos</button>' : ''}
      </div>
      <div class="console-stage"><div class="empty-console" aria-hidden="true"><img src="../../assets/icons/app-icon.svg" alt=""></div></div>
    </div>`;
    return;
  }

  const playable = game.system === 'gba' || game.system === 'nds';
  elements.hero.innerHTML = `<div class="hero-content">
    <div class="hero-copy">
      <div class="hero-kicker">
        <span class="system-tag ${game.system === 'nds' ? 'nds' : ''}">${escapeHtml(game.systemName)}</span>
        <span class="availability-tag ${game.available && playable ? '' : 'is-missing'}">${!game.available ? 'arquivo não encontrado' : playable ? 'pronto para jogar' : 'núcleo em desenvolvimento'}</span>
      </div>
      <h2>${escapeHtml(game.title)}</h2>
      <p class="hero-meta">${formatBytes(game.size)} · ${escapeHtml(relativeDate(game.lastPlayed))} · ${game.playCount || 0} ${game.playCount === 1 ? 'sessão' : 'sessões'}</p>
      <div class="hero-actions">
        <button class="primary-button" data-action="play" ${(game.available && playable) ? '' : 'disabled'}><svg><use href="#i-play"></use></svg>Jogar agora</button>
        <button class="secondary-button" data-action="reveal"><svg><use href="#i-folder"></use></svg>Ver arquivo</button>
        <button class="secondary-button" data-action="configure"><svg><use href="#i-settings"></use></svg>Ajustar emulador</button>
      </div>
    </div>
    <div class="console-stage">${consoleMarkup(game)}</div>
  </div>`;
}

function renderCard(game) {
  const selected = game.id === state.selectedId ? 'is-selected' : '';
  const missing = game.available ? '' : 'is-missing';
  return `<article class="game-card ${selected} ${missing} ${paletteClass(game)}" data-id="${escapeHtml(game.id)}" tabindex="0" role="button" aria-label="Selecionar ${escapeHtml(game.title)}">
    <div class="cover">
      <div class="cover-top"><span class="cover-system">${escapeHtml(game.system.toUpperCase())}</span><button class="heart-button ${game.favorite ? 'is-favorite' : ''}" data-action="favorite" aria-label="${game.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}"><svg><use href="#i-heart"></use></svg></button></div>
      <strong class="cover-title">${escapeHtml(game.title)}</strong>
    </div>
    <div class="card-info"><div><strong title="${escapeHtml(game.title)}">${escapeHtml(game.title)}</strong><small>${escapeHtml(relativeDate(game.lastPlayed))}</small></div><button class="more-button" data-action="remove" aria-label="Remover ${escapeHtml(game.title)} da biblioteca"><svg><use href="#i-more"></use></svg></button></div>
  </article>`;
}

function renderGrid(games) {
  elements.resultCount.textContent = `${games.length} ${games.length === 1 ? 'jogo' : 'jogos'}`;
  if (!games.length) {
    elements.grid.innerHTML = `<div class="no-results"><div><svg><use href="#i-search"></use></svg><strong>Nenhum jogo por aqui</strong><span>Tente outra pesquisa ou adicione mais arquivos.</span></div></div>`;
    return;
  }
  elements.grid.innerHTML = games.map(renderCard).join('');
}

function updateCounts() {
  for (const [id, filter] of Object.entries(FILTERS)) {
    const node = document.querySelector(`[data-count="${id}"]`);
    if (node) node.textContent = state.games.filter(filter.match).length;
  }
}

function render() {
  const descriptor = FILTERS[state.filter];
  elements.sectionTitle.textContent = descriptor.title;
  elements.sectionEyebrow.textContent = descriptor.eyebrow;
  elements.filters.querySelectorAll('.filter').forEach((button) => button.classList.toggle('is-active', button.dataset.filter === state.filter));
  updateCounts();
  const games = visibleGames();
  const active = selectedGame(games);
  if (active) state.selectedId = active.id;
  renderHero(games);
  renderGrid(games);
}

function setBusy(busy) {
  state.busy = busy;
  elements.addFiles.disabled = busy;
  elements.addFiles.lastChild.textContent = busy ? 'Importando…' : 'Adicionar jogos';
}

function toast(message, type = 'info') {
  const node = document.createElement('div');
  node.className = `toast ${type === 'error' ? 'is-error' : ''}`;
  node.textContent = message;
  elements.toastRegion.append(node);
  setTimeout(() => node.remove(), 4200);
}

function useResult(result, successMessage) {
  if (!result?.ok) {
    toast(result?.error || 'Não foi possível concluir a ação.', 'error');
    return false;
  }
  if (Array.isArray(result.games)) state.games = result.games;
  if (successMessage && !result.canceled) toast(successMessage(result));
  render();
  return true;
}

async function importFiles() {
  if (state.busy || state.demo) return;
  setBusy(true);
  try {
    const result = await window.duopocket.chooseFiles();
    useResult(result, (value) => `${value.imported.length} ${value.imported.length === 1 ? 'jogo adicionado' : 'jogos adicionados'}.`);
  } finally {
    setBusy(false);
  }
}

async function importFolder() {
  if (state.busy || state.demo) return;
  setBusy(true);
  document.querySelector('.import-menu').removeAttribute('open');
  try {
    const result = await window.duopocket.chooseFolder();
    useResult(result, (value) => value.scanned ? `${value.imported.length} de ${value.scanned} arquivos adicionados.` : 'Nenhum jogo compatível encontrado.');
  } finally {
    setBusy(false);
  }
}

async function launchSelected() {
  const game = selectedGame();
  if (!game || !game.available || !['gba', 'nds'].includes(game.system) || state.demo) return;
  const result = await window.duopocket.launch(game.id);
  if (useResult(result)) toast(`${game.title} foi aberto no ${game.engine === 'mgba' ? 'mGBA' : 'melonDS'}.`);
}

elements.filters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  state.filter = button.dataset.filter;
  state.selectedId = null;
  render();
});

elements.search.addEventListener('input', () => {
  state.query = elements.search.value;
  state.selectedId = null;
  render();
});

elements.addFiles.addEventListener('click', importFiles);
elements.addFolder.addEventListener('click', importFolder);

elements.hero.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  const game = selectedGame();
  if (action === 'add') await importFiles();
  if (action === 'play') await launchSelected();
  if (action === 'reveal' && game && !state.demo) useResult(await window.duopocket.reveal(game.id));
  if (action === 'configure' && game && !state.demo) {
    if (game.engine === 'mgba') toast('Os controles do DuoGBA ficam na janela do jogo.');
    else useResult(await window.duopocket.openEmulator(game.engine), () => 'Configurações do emulador abertas.');
  }
});

elements.grid.addEventListener('click', async (event) => {
  const card = event.target.closest('.game-card');
  if (!card) return;
  state.selectedId = card.dataset.id;
  const action = event.target.closest('[data-action]')?.dataset.action;

  if (action === 'favorite') {
    event.stopPropagation();
    if (!state.demo) useResult(await window.duopocket.toggleFavorite(card.dataset.id));
    return;
  }
  if (action === 'remove') {
    event.stopPropagation();
    state.removeTarget = card.dataset.id;
    elements.removeDialog.showModal();
    return;
  }
  render();
});

elements.grid.addEventListener('dblclick', (event) => {
  if (event.target.closest('.game-card')) launchSelected();
});

elements.grid.addEventListener('keydown', (event) => {
  const card = event.target.closest('.game-card');
  if (!card || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  state.selectedId = card.dataset.id;
  if (event.key === 'Enter') launchSelected();
  else render();
});

elements.removeDialog.addEventListener('close', async () => {
  if (elements.removeDialog.returnValue !== 'confirm' || !state.removeTarget || state.demo) return;
  const game = state.games.find((item) => item.id === state.removeTarget);
  const result = await window.duopocket.remove(state.removeTarget);
  if (useResult(result)) toast(`${game?.title || 'Jogo'} foi removido da estante.`);
  state.removeTarget = null;
});

document.querySelectorAll('[data-engine]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (state.demo) return;
    if (button.dataset.engine === 'mgba') toast('DuoGBA é o núcleo próprio em desenvolvimento.');
    else useResult(await window.duopocket.openEmulator(button.dataset.engine), () => 'Configurações do emulador abertas.');
  });
});

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    importFolder();
  } else if (event.ctrlKey && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    importFiles();
  } else if (event.ctrlKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    elements.search.focus();
  } else if (event.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON' && document.activeElement !== elements.search) {
    launchSelected();
  }
});

let dragDepth = 0;
document.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  elements.dropZone.classList.add('is-visible');
});
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) elements.dropZone.classList.remove('is-visible');
});
document.addEventListener('drop', async (event) => {
  event.preventDefault();
  dragDepth = 0;
  elements.dropZone.classList.remove('is-visible');
  if (state.demo) return;
  const paths = [...event.dataTransfer.files].map((file) => window.duopocket.filePath(file)).filter(Boolean);
  if (!paths.length) return;
  setBusy(true);
  try {
    const result = await window.duopocket.importPaths(paths);
    useResult(result, (value) => `${value.imported.length} ${value.imported.length === 1 ? 'jogo adicionado' : 'jogos adicionados'}.`);
  } finally {
    setBusy(false);
  }
});

async function init() {
  const result = await window.duopocket.getState();
  if (!result?.ok) {
    toast(result?.error || 'A biblioteca não pôde ser carregada.', 'error');
    render();
    return;
  }

  state.games = state.demo ? demoGames : result.games;
  state.emulators = result.emulators || {};
  for (const engine of ['mgba', 'melonds']) {
    const status = state.emulators[engine];
    const node = document.querySelector(`#${engine}-status`);
    if (node) node.textContent = status?.ready ? `${status.version} · pronto` : 'não encontrado';
  }
  const allReady = Object.values(state.emulators).every((item) => item.ready);
  document.querySelector('.status-light')?.classList.toggle('has-error', !allReady);
  render();
}

init().catch((error) => {
  console.error(error);
  toast('O DuoPocket não pôde iniciar.', 'error');
  render();
});
