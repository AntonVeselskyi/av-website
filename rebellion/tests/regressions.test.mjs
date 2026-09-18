import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const { handler } = await import('data:text/javascript;base64,' + Buffer.from(read('lambda-hackingEP-handler.txt')).toString('base64'));
async function command(raw, state = { cwd: '/root' }) {
  const response = await handler({ body: JSON.stringify({ server: 'node083', raw, state }) });
  assert.equal(response.statusCode, 200);
  return JSON.parse(response.body);
}

test('decryption requires the correct key and exposes a consistent per-session file', async () => {
  for (const raw of ['decrypt db_017', 'decrypt /wrong/key /root/databases/db_017.enc', 'openssl enc -d -in /root/databases/db_017.enc']) {
    const result = await command(raw);
    assert.equal(result.state.decrypted, false, raw);
    assert.notEqual(result.action, 'decrypt', raw);
  }
  for (const raw of [
    'decrypt /tmp/.hidden/key.pem /root/databases/db_017.enc',
    'openssl enc -d -aes-256-cbc -in /root/databases/db_017.enc -out /tmp/db_017.sql -kfile /tmp/.hidden/key.pem'
  ]) {
    const { state, action } = await command(raw);
    assert.equal(action, 'decrypt');
    for (const query of ['ls /tmp', 'stat /tmp/db_017.sql', 'head /tmp/db_017.sql', 'cat /tmp/db_017.sql', 'find /tmp -name "*.sql"', 'ls /tmp/*.sql']) {
      const { output } = await command(query, state);
      assert.ok(output.length, query);
      assert.doesNotMatch(output, /No such file|cannot|Permission denied/, query);
    }
    const sql = await command('sqlite3 /tmp/db_017.sql', state);
    assert.match((await command('SELECT * FROM entries;', sql.state)).output, /GoodGirl17/);
  }
  assert.doesNotMatch((await command('ls /tmp')).output, /db_017.sql/);
  assert.match((await command('head /tmp/db_017.sql')).output, /No such file/);
});

function shell(page, storage = new Map()) {
  const timers = new Map();
  const frames = [];
  const elements = new Map();
  function element() {
    return {
      value: '', textContent: '', className: '', style: {}, children: [], listeners: {},
      selectionStart: 0, selectionEnd: 0, scrollHeight: 1000, clientHeight: 200, scrollTop: 800,
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      appendChild(el) { this.children.push(el); }, replaceChildren(...els) { this.children = els; },
      after() {}, focus() {}, blur() {}, remove() {}, scrollIntoView() {},
      setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
      classList: { add() {}, remove() {}, contains() { return false; } }
    };
  }
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element, addEventListener() {}, documentElement: element(), body: element()
  };
  const context = vm.createContext({
    document, window: { addEventListener() {} }, performance, AbortController,
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setTimeout(fn, ms) { const id = {}; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); }, setInterval() {}, clearInterval() {},
    requestAnimationFrame(fn) { frames.push(fn); },
    fetch: async () => { throw new Error('offline'); }
  });
  const script = read(page).match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/if \(!restoreSession\(\)\) boot\(\);(?:\nelse startLiveAlerts\(\);)?/, '')
    .replace(/\nbootSequence\(\);/, '');
  vm.runInContext(script, context);
  return { context, elements, timers, frames, run: code => vm.runInContext(code, context), storage };
}

for (const page of ['server1.html', 'server2.html']) {
  test(page + ': delayed completion cannot overwrite subsequent input', async () => {
    const app = shell(page);
    app.run("setCmd('cat no'); getCompletionsFor = () => new Promise(resolve => globalThis.finish = resolve)");
    const pending = app.run("onShellKeydown({key:'Tab', preventDefault(){}})");
    app.run("setCmd('cat notes.txt | head')");
    app.context.finish({ prefix: 'cat ', after: '', word: 'no', cands: ['notes.txt'] });
    await pending;
    assert.equal(app.run('cmdEl.value'), 'cat notes.txt | head');
  });

  test(page + ': timeout restores the prompt and failed command for retry', async () => {
    const app = shell(page);
    app.context.fetch = (_, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })));
    });
    app.run("setCmd('ls /tmp')");
    const pending = app.run('submitCommand()');
    const timeout = [...app.timers.values()].find(timer => timer.ms === 12000);
    assert.ok(timeout);
    timeout.fn();
    await pending;
    assert.equal(app.run('cmdEl.value'), 'ls /tmp');
    assert.equal(app.run('inpRow.style.display'), 'flex');
    assert.equal(app.run('commandInFlight'), false);
    assert.match(app.elements.get('out').children.map(el => el.textContent).join('\n'), /timed out.*retry/);
    assert.equal([...app.timers.values()].some(timer => timer.ms === 12000), false);
  });

  test(page + ': alerts preserve reading position and resume following at bottom', () => {
    const app = shell(page);
    const out = app.elements.get('out');
    out.scrollTop = 100;
    out.listeners.scroll[0]();
    app.run("addLine('incoming alert')");
    app.frames.splice(0).forEach(fn => fn());
    assert.equal(out.scrollTop, 100);
    out.scrollTop = 800;
    out.listeners.scroll[0]();
    out.scrollHeight = 1100;
    app.run("addLine('next alert')");
    assert.equal(out.scrollTop, 1100);
  });

  test(page + ': reload restores progress, history, draft, transcript and scroll', () => {
    const app = shell(page);
    app.run("S.cwd='/tmp'; S.hist=['ls']; S.decrypted=true; S.sqliteMode=true; S.sqliteFile='/tmp/db_017.sql'; addLine('saved output'); setCmd('SELECT '); followOutput=false; out.scrollTop=100; saveSession()");
    const restored = shell(page, app.storage);
    assert.equal(restored.run('restoreSession()'), true);
    assert.equal(restored.run('S.cwd'), '/tmp');
    assert.equal(restored.run("S.hist.join(',')"), 'ls');
    assert.equal(restored.run('cmdEl.value'), 'SELECT ');
    assert.equal(restored.elements.get('out').children[0].textContent, 'saved output');
    assert.equal(restored.run('out.scrollTop'), 100);
    if (page === 'server2.html') {
      assert.equal(restored.run('S.decrypted'), true);
      assert.equal(restored.run('promptEl.textContent'), 'sqlite> ');
    }
  });
}

test('first SSH accepts yes', async () => {
  const app = shell('server1.html');
  app.run("S.sshWait=true; setCmd('yes'); sshGo=async()=>{globalThis.navigated=true}");
  await app.run('submitCommand()');
  assert.equal(app.context.navigated, true);
});

test('final reveal falls back when the request times out', async () => {
  const app = shell('server3.html');
  app.context.fetch = (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const pending = app.run('fetchReveal()');
  [...app.timers.values()].find(timer => timer.ms === 12000).fn();
  assert.equal((await pending).date, app.run('FALLBACK_REVEAL_DATE'));
});

test('saved reveal renders without requiring another network request', async () => {
  const app = shell('server3.html');
  app.run("replyZone = document.createElement('div')");
  const pending = app.run("revealEnd({output: 'saved ending', date: 'saved date'})");
  [...app.timers.values()].find(timer => timer.ms === 400).fn();
  await pending;
  assert.match(app.run('replyZone.children[0].innerHTML'), /saved ending/);
  assert.equal(JSON.parse(app.storage.get('rebellion:v1:reveal')).date, 'saved date');
});

test('unavailable storage does not prevent shell interaction', () => {
  const app = shell('server2.html');
  app.context.sessionStorage.getItem = () => { throw new Error('disabled'); };
  app.context.sessionStorage.setItem = () => { throw new Error('disabled'); };
  assert.equal(app.run('restoreSession()'), false);
  assert.doesNotThrow(() => app.run('saveSession()'));
});
