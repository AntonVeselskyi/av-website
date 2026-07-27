const CODES = {
  game: {
    label: 'Game C++', filename: 'ProjectileSystem.cpp', hl: 20,
    lines: [
      [['pp', '#pragma once']],
      [['pp', '#include '], ['st', '"CollisionQuery.h"']],
      [['pp', '#include '], ['st', '"World.h"']],
      null,
      [['kw', 'enum class '], ['cl', 'ImpactResponse'], ['pl', ' : '], ['bi', 'u8']],
      [['pl', '{']],
      [['pl', '    '], ['en', 'Absorb'], ['pl', ', '], ['en', 'Ricochet'], ['pl', ', '], ['en', 'Penetrate'], ['pl', ' = '], ['nm', '0xFF']],
      [['pl', '};']],
      null,
      [['kw', 'template'], ['pl', '<'], ['kw', 'typename '], ['ty', 'T'], ['pl', ', '], ['bi', 'u32 '], ['va', 'N'], ['pl', ' = '], ['nm', '4'], ['pl', '>']],
      [['kw', 'struct '], ['cl', 'HitBuffer']],
      [['pl', '{']],
      [['pl', '    '], ['ty', 'T'], ['pl', '*          '], ['va', 'actors'], ['pl', '['], ['va', 'N'], ['pl', '] = {};']],
      [['pl', '    '], ['bi', 'float'], ['pl', '      '], ['va', 'distances'], ['pl', '['], ['va', 'N'], ['pl', '] = {};']],
      [['pl', '    '], ['cl', 'ImpactResponse'], ['pl', ' '], ['va', 'response'], ['pl', ' = '], ['en', 'ImpactResponse::Absorb'], ['pl', ';']],
      [['pl', '};']],
      null,
      [['kw', 'static '], ['bi', 'bool']],
      [['cl', 'ProjectileSystem'], ['pl', '::'], ['mt', 'Trace'], ['pl', '('], ['kw', 'const '], ['cl', 'Ray'], ['pl', '& '], ['va', 'ray'], ['pl', ', '], ['cl', 'HitBuffer'], ['pl', '<'], ['cl', 'Actor'], ['pl', '> '], ['pl', '& '], ['va', 'out'], ['pl', ')']],
      [['pl', '{']],
      [['pl', '    '], ['kw', 'constexpr '], ['bi', 'float'], ['pl', ' '], ['va', 'kMaxDist'], ['pl', ' = '], ['nm', '8000.f'], ['pl', ';']],
      [['pl', '    '], ['kw', 'const '], ['bi', 'u32'], ['pl', ' '], ['va', 'n'], ['pl', ' = '], ['cl', 'World'], ['pl', '::'], ['mt', 'SweepSphere'], ['pl', '('], ['va', 'ray'], ['pl', ', '], ['nm', '.05f'], ['pl', ', '], ['va', 'kMaxDist'], ['pl', ', '], ['va', 'out'], ['pl', ');']],
      [['pl', '    '], ['kw', 'switch'], ['pl', ' ('], ['va', 'out'], ['pl', '.'], ['va', 'response'], ['pl', ')']],
      [['pl', '    {']],
      [['pl', '    '], ['kw', 'case '], ['en', 'ImpactResponse::Ricochet'], ['pl', '  : '], ['va', 'out'], ['pl', '.'], ['va', 'distances'], ['pl', '['], ['nm', '0'], ['pl', '] *= '], ['nm', '.4f'], ['pl', '; '], ['kw', 'break'], ['pl', ';']],
      [['pl', '    '], ['kw', 'case '], ['en', 'ImpactResponse::Penetrate'], ['pl', ': '], ['kw', 'break'], ['pl', ';']],
      [['pl', '    '], ['kw', 'default'], ['pl', ':                    '], ['kw', 'return '], ['kw', 'false'], ['pl', ';']],
      [['pl', '    }']],
      [['pl', '    '], ['kw', 'return '], ['va', 'n'], ['pl', ' > '], ['nm', '0'], ['pl', ';']],
      [['pl', '}']],
    ],
  },
  ue: {
    label: 'Unreal Engine', filename: 'APlayerCharacter.cpp', hl: 17,
    lines: [
      [['pp', '#include '], ['st', '"APlayerCharacter.h"']],
      [['pp', '#include '], ['st', '"MovementComponent.h"']],
      [['pp', '#include '], ['st', '"Components/SkeletalMeshComponent.h"']],
      null,
      [['mc', 'DEFINE_LOG_CATEGORY_STATIC'], ['pl', '('], ['va', 'LogPlayer'], ['pl', ', '], ['en', 'Log'], ['pl', ', '], ['en', 'All'], ['pl', ')']],
      null,
      [['cm', '// Called from movement component on landing']],
      [['bi', 'void '], ['cl', 'APlayerCharacter'], ['pl', '::'], ['mt', 'OnLanded'], ['pl', '('], ['kw', 'const '], ['cl', 'FHitResult'], ['pl', '& '], ['va', 'Hit'], ['pl', ')']],
      [['pl', '{']],
      [['pl', '    '], ['kw', 'const '], ['bi', 'float'], ['pl', ' '], ['va', 'FallSpeed'], ['pl', ' = '], ['mt', 'GetVelocity'], ['pl', '().'], ['va', 'Z'], ['pl', ';']],
      [['pl', '    '], ['mc', 'UE_LOG'], ['pl', '('], ['va', 'LogPlayer'], ['pl', ', '], ['en', 'Verbose'], ['pl', ', '], ['st', '"Landed speed=%.1f"'], ['pl', ', '], ['va', 'FallSpeed'], ['pl', ');']],
      null,
      [['pl', '    '], ['kw', 'if '], ['pl', '('], ['va', 'FallSpeed'], ['pl', ' < '], ['nm', '-1200.f'], ['pl', ')']],
      [['pl', '    {']],
      [['pl', '        '], ['mt', 'ApplyFallDamage'], ['pl', '('], ['va', 'FallSpeed'], ['pl', ');']],
      [['pl', '        '], ['kw', 'return'], ['pl', ';']],
      [['pl', '    }']],
      null,
      [['pl', '    '], ['mt', 'PlayLandMontage'], ['pl', '();']],
      [['pl', '}']],
      null,
      [['bi', 'void '], ['cl', 'APlayerCharacter'], ['pl', '::'], ['mt', 'ApplyFallDamage'], ['pl', '('], ['bi', 'float '], ['va', 'Speed'], ['pl', ')']],
      [['pl', '{']],
      [['pl', '    '], ['kw', 'const '], ['bi', 'float'], ['pl', ' '], ['va', 'Dmg'], ['pl', ' = '], ['cl', 'FMath'], ['pl', '::'], ['mt', 'Abs'], ['pl', '('], ['va', 'Speed'], ['pl', ') * '], ['nm', '.04f'], ['pl', ';']],
      [['pl', '    '], ['mt', 'TakeDamage'], ['pl', '('], ['va', 'Dmg'], ['pl', ', '], ['cl', 'FDamageEvent'], ['pl', '(), '], ['kw', 'nullptr'], ['pl', ', '], ['kw', 'this'], ['pl', ');']],
      [['pl', '}']],
    ],
  },
  net: {
    label: 'C Network', filename: 'relay_server.c', hl: 16,
    lines: [
      [['pp', '#include '], ['st', '"relay.h"']],
      [['pp', '#include '], ['pl', '<'], ['pp', 'sys/epoll.h'], ['pl', '>']],
      [['pp', '#include '], ['pl', '<'], ['pp', 'netinet/tcp.h'], ['pl', '>']],
      null,
      [['pp', '#define '], ['mc', 'MAX_EVENTS'], ['pl', '  '], ['nm', '64']],
      [['pp', '#define '], ['mc', 'BUF_SIZE'], ['pl', '   '], ['nm', '4096']],
      null,
      [['kw', 'typedef struct']],
      [['pl', '{']],
      [['pl', '    '], ['bi', 'int'], ['pl', '      '], ['va', 'fd'], ['pl', ';']],
      [['pl', '    '], ['bi', 'uint32_t'], ['pl', ' '], ['va', 'peer_ip'], ['pl', ';']],
      [['pl', '    '], ['bi', 'uint16_t'], ['pl', ' '], ['va', 'peer_port'], ['pl', ';']],
      [['pl', '    '], ['bi', 'char'], ['pl', '     '], ['va', 'buf'], ['pl', '['], ['mc', 'BUF_SIZE'], ['pl', '];']],
      [['pl', '} '], ['cl', 'relay_conn_t'], ['pl', ';']],
      null,
      [['kw', 'static '], ['bi', 'int'], ['pl', ' '], ['mt', 'set_nonblocking'], ['pl', '('], ['bi', 'int '], ['va', 'fd'], ['pl', ')']],
      [['pl', '{']],
      [['pl', '    '], ['bi', 'int '], ['va', 'flags'], ['pl', ' = '], ['mt', 'fcntl'], ['pl', '('], ['va', 'fd'], ['pl', ', '], ['en', 'F_GETFL'], ['pl', ', '], ['nm', '0'], ['pl', ');']],
      [['pl', '    '], ['kw', 'if '], ['pl', '('], ['va', 'flags'], ['pl', ' < '], ['nm', '0'], ['pl', ') '], ['kw', 'return '], ['nm', '-1'], ['pl', ';']],
      [['pl', '    '], ['kw', 'return '], ['mt', 'fcntl'], ['pl', '('], ['va', 'fd'], ['pl', ', '], ['en', 'F_SETFL'], ['pl', ', '], ['va', 'flags'], ['pl', ' | '], ['en', 'O_NONBLOCK'], ['pl', ');']],
      [['pl', '}']],
      null,
      [['bi', 'int'], ['pl', ' '], ['mt', 'relay_loop'], ['pl', '('], ['bi', 'int '], ['va', 'listen_fd'], ['pl', ')']],
      [['pl', '{']],
      [['pl', '    '], ['ty', 'struct epoll_event '], ['va', 'ev'], ['pl', ', '], ['va', 'events'], ['pl', '['], ['mc', 'MAX_EVENTS'], ['pl', '];']],
      [['pl', '    '], ['bi', 'int '], ['va', 'epfd'], ['pl', ' = '], ['mt', 'epoll_create1'], ['pl', '('], ['nm', '0'], ['pl', ');']],
      [['pl', '    '], ['kw', 'if '], ['pl', '('], ['va', 'epfd'], ['pl', ' < '], ['nm', '0'], ['pl', ') '], ['kw', 'return '], ['nm', '-1'], ['pl', ';']],
      [['pl', '    '], ['va', 'ev'], ['pl', '.'], ['va', 'events'], ['pl', ' = '], ['en', 'EPOLLIN'], ['pl', ';  '], ['va', 'ev'], ['pl', '.'], ['va', 'data'], ['pl', '.'], ['va', 'fd'], ['pl', ' = '], ['va', 'listen_fd'], ['pl', ';']],
      [['pl', '    '], ['mt', 'epoll_ctl'], ['pl', '('], ['va', 'epfd'], ['pl', ', '], ['en', 'EPOLL_CTL_ADD'], ['pl', ', '], ['va', 'listen_fd'], ['pl', ', &'], ['va', 'ev'], ['pl', ');']],
      [['pl', '    '], ['cm', '// event loop omitted for brevity']],
      [['pl', '    '], ['kw', 'return '], ['nm', '0'], ['pl', ';']],
      [['pl', '}']],
    ],
  },
  std: {
    label: 'STL-heavy C++', filename: 'asset_cache.cpp', hl: 17,
    lines: [
      [['pp', '#include '], ['pl', '<'], ['pp', 'unordered_map'], ['pl', '>']],
      [['pp', '#include '], ['pl', '<'], ['pp', 'memory'], ['pl', '>']],
      [['pp', '#include '], ['pl', '<'], ['pp', 'functional'], ['pl', '>']],
      [['pp', '#include '], ['pl', '<'], ['pp', 'optional'], ['pl', '>']],
      null,
      [['kw', 'template'], ['pl', '<'], ['kw', 'typename '], ['ty', 'K'], ['pl', ', '], ['kw', 'typename '], ['ty', 'V'], ['pl', '>']],
      [['kw', 'class '], ['cl', 'LRUCache']],
      [['pl', '{']],
      [['pl', '    '], ['kw', 'using '], ['cl', 'Map'], ['pl', ' = '], ['ty', 'std::unordered_map'], ['pl', '<'], ['ty', 'K'], ['pl', ', '], ['ty', 'std::shared_ptr'], ['pl', '<'], ['ty', 'V'], ['pl', '>>;']],
      [['pl', '    '], ['cl', 'Map'], ['pl', '             '], ['va', 'cache_'], ['pl', ';']],
      [['pl', '    '], ['bi', 'std::size_t'], ['pl', '  '], ['va', 'cap_'], ['pl', ';']],
      null,
      [['kw', 'public'], ['pl', ':']],
      [['pl', '    '], ['kw', 'explicit '], ['cl', 'LRUCache'], ['pl', '('], ['bi', 'std::size_t '], ['va', 'cap'], ['pl', ') : '], ['va', 'cap_'], ['pl', '{'], ['va', 'cap'], ['pl', '} {}']],
      null,
      [['pl', '    '], ['ty', 'std::optional'], ['pl', '<'], ['ty', 'std::shared_ptr'], ['pl', '<'], ['ty', 'V'], ['pl', '>> '], ['mt', 'get'], ['pl', '('], ['kw', 'const '], ['ty', 'K'], ['pl', '& '], ['va', 'key'], ['pl', ')']],
      [['pl', '    {']],
      [['pl', '        '], ['kw', 'auto '], ['va', 'it'], ['pl', ' = '], ['va', 'cache_'], ['pl', '.'], ['mt', 'find'], ['pl', '('], ['va', 'key'], ['pl', ');']],
      [['pl', '        '], ['kw', 'if '], ['pl', '('], ['va', 'it'], ['pl', ' == '], ['va', 'cache_'], ['pl', '.'], ['mt', 'end'], ['pl', '()) '], ['kw', 'return '], ['ty', 'std::nullopt'], ['pl', ';']],
      [['pl', '        '], ['kw', 'return '], ['va', 'it'], ['pl', '->'], ['va', 'second'], ['pl', ';']],
      [['pl', '    }']],
      null,
      [['pl', '    '], ['bi', 'void '], ['mt', 'put'], ['pl', '('], ['ty', 'K '], ['va', 'key'], ['pl', ', '], ['ty', 'std::shared_ptr'], ['pl', '<'], ['ty', 'V'], ['pl', '> '], ['va', 'val'], ['pl', ')']],
      [['pl', '    {']],
      [['pl', '        '], ['kw', 'if '], ['pl', '('], ['va', 'cache_'], ['pl', '.'], ['mt', 'size'], ['pl', '() >= '], ['va', 'cap_'], ['pl', ') '], ['va', 'cache_'], ['pl', '.'], ['mt', 'clear'], ['pl', '();']],
      [['pl', '        '], ['va', 'cache_'], ['pl', '['], ['ty', 'std::move'], ['pl', '('], ['va', 'key'], ['pl', ')] = '], ['ty', 'std::move'], ['pl', '('], ['va', 'val'], ['pl', ');']],
      [['pl', '    }']],
      [['pl', '};']],
    ],
  },
  shrt: {
    label: 'SHRT', filename: 'player_inspector.cpp', hl: 19,
    lines: [
      [['pp', 'i '], ['pl', 'iostream']],
      [['pp', 'i '], ['pl', 'format']],
      [['pp', 'i '], ['pl', 'string']],
      null,
      [['kw', 's '], ['cl', 'Weapon']],
      [['pl', '{']],
      [['pl', '    '], ['bi', '$string'], ['pl', ' '], ['va', 'name'], ['pl', ';']],
      [['pl', '    '], ['bi', 'int'], ['pl', ' '], ['va', 'damage'], ['pl', ';']],
      [['pl', '};']],
      null,
      [['kw', 's '], ['cl', 'Player']],
      [['pl', '{']],
      [['pl', '    '], ['bi', '$string'], ['pl', ' '], ['va', 'name'], ['pl', ';']],
      [['pl', '    '], ['cl', 'Weapon'], ['pl', '* '], ['va', 'weapon'], ['pl', ';']],
      [['pl', '    '], ['bi', 'int'], ['pl', ' '], ['va', 'hp'], ['pl', ';']],
      [['pl', '};']],
      null,
      [['bi', 'void'], ['pl', ' '], ['mt', 'inspect'], ['pl', '('], ['cl', 'Player'], ['pl', '* '], ['va', 'player'], ['pl', ')']],
      [['pl', '{']],
      [['pl', '    '], ['va', 'player'], ['pl', ' '], ['mc', '??'], ['pl', ' '], ['kw', 'r'], ['pl', ';']],
      null,
      [['pl', '    '], ['kw', 'a'], ['pl', ' '], ['va', 'weapon_name'], ['pl', ' = '], ['va', 'player'], ['pl', '->'], ['va', 'weapon'], ['mc', '?.'], ['va', 'name'], ['pl', ' '], ['mc', '??'], ['pl', ' '], ['st', '"fists"'], ['pl', ';']],
      [['pl', '    '], ['kw', 'a'], ['pl', ' '], ['va', 'weapon_dmg'], ['pl', '  = '], ['va', 'player'], ['pl', '->'], ['va', 'weapon'], ['mc', '?.'], ['va', 'damage'], ['pl', ' '], ['mc', '??'], ['pl', ' '], ['nm', '1'], ['pl', ';']],
      null,
      [['pl', '    '], ['kw', 'p'], ['pl', ' '], ['st', '$"{player->name} wields {weapon_name} ({weapon_dmg}dmg) hp={player->hp}"'], ['pl', ';']],
      [['pl', '}']],
    ],
  },
};

const TOKEN_CLASS = {
  pp: 'preproc', st: 'string', mc: 'macro', pl: 'plain', cm: 'comment',
  kw: 'kw', uk: 'kw', cl: 'class', bi: 'type', ty: 'class', en: 'syntax-token',
  va: 'var', mt: 'fn', nm: 'number',
};

const codeView = document.getElementById('code-view');
const codeTabs = document.getElementById('code-tabs');
const filename = document.getElementById('sample-file');
const sampleName = document.getElementById('sample-name');
let activeSample = 'ue';

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderSample(key, focusTab = false) {
  const sample = CODES[key];
  if (!sample) return;
  activeSample = key;
  filename.textContent = sample.filename;
  sampleName.textContent = `${sample.label} · semantic preview`;
  codeView.innerHTML = sample.lines.map((line, index) => {
    const tokens = line
      ? line.map(([token, value]) => `<span class="${TOKEN_CLASS[token] || 'plain'}">${escapeHtml(value)}</span>`).join('')
      : '';
    return `<span class="line${index === sample.hl ? ' hot' : ''}"><span class="ln">${index + 1}</span>${tokens}</span>`;
  }).join('');
  codeView.scrollLeft = 0;
  codeTabs.querySelectorAll('[role="tab"]').forEach((tab) => {
    const selected = tab.dataset.sample === key;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focusTab) tab.focus();
  });
}

codeTabs.innerHTML = Object.entries(CODES).map(([key, sample]) =>
  `<button type="button" role="tab" data-sample="${key}" aria-selected="false">${sample.label}</button>`
).join('');

codeTabs.addEventListener('click', (event) => {
  const tab = event.target.closest('[role="tab"]');
  if (tab) renderSample(tab.dataset.sample);
});

codeTabs.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const keys = Object.keys(CODES);
  let index = keys.indexOf(activeSample);
  if (event.key === 'ArrowLeft') index = (index - 1 + keys.length) % keys.length;
  if (event.key === 'ArrowRight') index = (index + 1) % keys.length;
  if (event.key === 'Home') index = 0;
  if (event.key === 'End') index = keys.length - 1;
  renderSample(keys[index], true);
});

renderSample(activeSample);

const poster = document.querySelector('.poster');
const scheme = document.querySelector('.scheme');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let pageTurning = false;
let touchStartY = null;

function turnPage(destination) {
  if (pageTurning) return;
  pageTurning = true;
  const top = destination === 'preview' ? scheme.offsetTop : poster.offsetTop;
  window.scrollTo({ top, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  window.setTimeout(() => { pageTurning = false; }, reducedMotion.matches ? 80 : 720);
}

window.addEventListener('wheel', (event) => {
  const previewTop = scheme.offsetTop;
  const onPosterLeaf = window.scrollY < previewTop - 2;
  const atPreviewStart = window.scrollY >= previewTop - 2 && window.scrollY <= previewTop + 3;
  if (event.deltaY > 0 && onPosterLeaf) {
    event.preventDefault();
    turnPage('preview');
  } else if (event.deltaY < 0 && atPreviewStart) {
    event.preventDefault();
    turnPage('poster');
  } else if (pageTurning) {
    event.preventDefault();
  }
}, { passive: false });

window.addEventListener('touchstart', (event) => {
  if (event.touches.length === 1) touchStartY = event.touches[0].clientY;
}, { passive: true });

window.addEventListener('touchmove', (event) => {
  if (touchStartY === null || event.touches.length !== 1) return;
  const previewTop = scheme.offsetTop;
  const distance = touchStartY - event.touches[0].clientY;
  if (distance > 12 && window.scrollY < previewTop - 2) {
    event.preventDefault();
    touchStartY = null;
    turnPage('preview');
  } else if (distance < -12 && window.scrollY >= previewTop - 2 && window.scrollY <= previewTop + 3) {
    event.preventDefault();
    touchStartY = null;
    turnPage('poster');
  }
}, { passive: false });

window.addEventListener('touchend', () => { touchStartY = null; }, { passive: true });

window.addEventListener('keydown', (event) => {
  const previewTop = scheme.offsetTop;
  const downKeys = ['PageDown', 'ArrowDown', ' '];
  const upKeys = ['PageUp', 'ArrowUp'];
  if (downKeys.includes(event.key) && window.scrollY < previewTop - 2) {
    event.preventDefault();
    turnPage('preview');
  } else if (upKeys.includes(event.key) && window.scrollY >= previewTop - 2 && window.scrollY <= previewTop + 3) {
    event.preventDefault();
    turnPage('poster');
  }
});

if (window.location.hash === '#preview') {
  window.requestAnimationFrame(() => window.scrollTo({ top: scheme.offsetTop, behavior: 'auto' }));
}
