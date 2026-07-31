import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
};

function browserCandidates() {
  const supplied = process.env.BROWSER_BIN ? [process.env.BROWSER_BIN] : [];
  const local = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  return [
    ...supplied,
    join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    join(local, "Google", "Chrome", "Application", "chrome.exe"),
    join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/microsoft-edge",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((value, index, values) => value && values.indexOf(value) === index);
}

function resolveBrowser(candidate) {
  if (isAbsolute(candidate) && existsSync(candidate)) return candidate;
  for (const directory of String(process.env.PATH || "").split(delimiter)) {
    const resolved = join(directory, candidate);
    if (existsSync(resolved)) return resolved;
  }
  return null;
}

function findBrowser() {
  for (const candidate of browserCandidates()) {
    const resolved = resolveBrowser(candidate);
    if (resolved) return resolved;
  }
  return null;
}

function launchBrowser(executable, args, timeoutMs = 12000) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      rejectLaunch(new Error(`headless browser did not expose DevTools within ${timeoutMs}ms\n${stderr.slice(-1200)}`));
    }, timeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (!match) return;
      clearTimeout(timer);
      resolveLaunch({ child, websocketUrl: match[1], stderr: () => stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectLaunch(error);
    });
    child.on("close", (code) => {
      if (!stderr.includes("DevTools listening on")) {
        clearTimeout(timer);
        rejectLaunch(new Error(`headless browser exited before DevTools was ready (${code})\n${stderr.slice(-1200)}`));
      }
    });
  });
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.events = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        this.events.push(message);
        return;
      }
      if (!this.pending.has(message.id)) return;
      const { resolve: resolveCall, reject: rejectCall } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) rejectCall(new Error(`${message.error.message} (${message.error.code})`));
      else resolveCall(message.result);
    });
  }

  static connect(url) {
    return new Promise((resolveConnect, rejectConnect) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolveConnect(new CdpClient(socket)), { once: true });
      socket.addEventListener("error", () => rejectConnect(new Error("could not connect to browser DevTools")), { once: true });
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = ++this.sequence;
    return new Promise((resolveCall, rejectCall) => {
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

async function evaluate(client, sessionId, expression) {
  const evaluation = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);
  if (evaluation.exceptionDetails) {
    throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text || "browser evaluation failed");
  }
  return evaluation.result?.value;
}

async function pollValue(client, sessionId, expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(client, sessionId, expression);
      if (value) return value;
    } catch {
      // Navigation can replace the execution context between polls.
    }
    await wait(100);
  }
  throw new Error(`browser condition timed out: ${expression}`);
}

async function pressKey(client, sessionId, key, code, windowsVirtualKeyCode) {
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode }, sessionId);
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode }, sessionId);
}

const browser = findBrowser();
if (typeof WebSocket !== "function") {
  console.error("The visual smoke test requires Node 22 or newer (global WebSocket is unavailable).");
  process.exitCode = 1;
} else if (!browser) {
  console.error("No Chrome or Edge installation found. Set BROWSER_BIN to run the visual smoke test.");
  process.exitCode = 1;
} else {
  let profile = null;
  let launched = null;
  let client = null;
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
      const requested = pathname === "/" ? "/visual-lab.html" : pathname;
      const file = resolve(root, `.${requested}`);
      if (!file.startsWith(`${root}\\`) && !file.startsWith(`${root}/`)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": mime[extname(file).toLowerCase()] || "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });

  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    profile = await mkdtemp(join(tmpdir(), "signspell-visual-smoke-"));
    const url = `http://127.0.0.1:${address.port}/visual-lab.html?smoke=1`;
    launched = await launchBrowser(browser, [
      "--headless=new",
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--autoplay-policy=no-user-gesture-required",
      "--force-device-scale-factor=1",
      "--window-size=1440,1000",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ]);
    client = await CdpClient.connect(launched.websocketUrl);
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Page.enable", {}, sessionId);
    await client.send("Page.navigate", { url }, sessionId);

    const result = await pollValue(client, sessionId, "window.__SIGN_SPELL_VISUAL_SMOKE__ || null", 45000);
    if (!result) throw new Error(`visual smoke result was not emitted\n${launched.stderr().slice(-1800)}`);
    if (result.warnings?.length) console.warn(`Visual smoke warnings: ${result.warnings.length}`);
    if (result.status !== "pass") {
      for (const failure of result.failures || []) console.error(`FAIL ${failure.message}`, failure.details || "");
      process.exitCode = 1;
    } else {
      const eventCursor = client.events.length;
      await client.send("Page.navigate", { url: `http://127.0.0.1:${address.port}/index.html?smoke=1` }, sessionId);
      await pollValue(client, sessionId, "document.querySelector('#start-app') && document.readyState === 'complete'");
      await evaluate(client, sessionId, "document.querySelector('#start-app').click(); true");
      await pollValue(client, sessionId, "!document.querySelector('#workstation').hidden");
      await evaluate(client, sessionId, "document.querySelector('#maximize-visualizer').click(); true");
      await wait(120);
      for (let index = 0; index < 18; index += 1) {
        await pressKey(client, sessionId, "Tab", "Tab", 9);
        const inside = await evaluate(client, sessionId, "Boolean(document.activeElement?.closest('.visualizer-panel'))");
        if (!inside) throw new Error(`maximize focus escaped the visualizer after ${index + 1} Tab presses`);
      }
      await evaluate(client, sessionId, "document.querySelector('#calibration-dialog').showModal(); true");
      await pressKey(client, sessionId, "Escape", "Escape", 27);
      await wait(80);
      const dialogState = await evaluate(client, sessionId, `(() => {
        const panel = document.querySelector('.visualizer-panel');
        return {
          dialogOpen: document.querySelector('#calibration-dialog').open,
          maximized: panel.classList.contains('is-maximized'),
          outsideInert: [...document.querySelectorAll('.desktop-grid > :not(.visualizer-panel)')].every((element) => element.inert),
        };
      })()`);
      if (dialogState.dialogOpen || !dialogState.maximized || !dialogState.outsideInert) {
        throw new Error(`maximize/dialog state failed: ${JSON.stringify(dialogState)}`);
      }
      await evaluate(client, sessionId, `(() => {
        const panel = document.querySelector('.visualizer-panel');
        Object.defineProperty(panel, 'requestFullscreen', { configurable: true, value: () => Promise.reject(new Error('smoke denial')) });
        document.querySelector('#fullscreen-visualizer').click();
        return true;
      })()`);
      await wait(100);
      const rejectionPreserved = await evaluate(client, sessionId, "document.querySelector('.visualizer-panel').classList.contains('is-maximized')");
      if (!rejectionPreserved) throw new Error("denied native fullscreen discarded browser-window maximize");
      await pressKey(client, sessionId, "Escape", "Escape", 27);
      const restored = await evaluate(client, sessionId, `(() => ({
        maximized: document.querySelector('.visualizer-panel').classList.contains('is-maximized'),
        inert: [...document.querySelectorAll('[data-visualizer-inert]')].length,
      }))()`);
      if (restored.maximized || restored.inert) throw new Error(`maximize did not restore cleanly: ${JSON.stringify(restored)}`);
      const runtimeFailures = client.events.slice(eventCursor).filter((event) => (
        event.method === "Runtime.exceptionThrown"
        || (event.method === "Runtime.consoleAPICalled" && event.params?.type === "error")
      ));
      if (runtimeFailures.length) throw new Error(`UI smoke emitted ${runtimeFailures.length} runtime error(s)`);
      console.log(`Visual smoke passed: ${result.checks} checks across ${result.modes.length} modes; UI maximize checks passed.`);
    }
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  } finally {
    if (client) await client.send("Browser.close").catch(() => {});
    else launched?.child?.kill();
    if (launched?.child && launched.child.exitCode === null) {
      await Promise.race([
        new Promise((resolveExit) => launched.child.once("close", resolveExit)),
        wait(3000),
      ]);
    }
    await new Promise((resolveClose) => server.close(resolveClose));
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 120 });
  }
}
