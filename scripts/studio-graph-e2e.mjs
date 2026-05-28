#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCESS_GROUP_ID = "studio-e2e";
const ACCESS_PASSWORD = "studio-e2e-password";
const ACCESS_SECRET = "studio-e2e-access-secret";
const ADMIN_TOKEN = "studio-e2e-admin-token";
const ACCESS_GROUPS_PATH = path.join(rootDir, "data", "access", "access-groups.json");

process.env.ACCESS_TOKEN_SECRET = ACCESS_SECRET;

let failureCount = 0;
const createdNotebookIds = [];
let accessBackup = undefined;
let server = null;
let browser = null;

try {
  const fixture = await setupFixture();
  const port = await freePort();
  server = await startServer(port);
  browser = await launchBrowser();

  await run("selected notebook renders Studio graph", () => testGraphRenders(fixture, port));
  await run("notebook without graph shows empty guidance", () => testNoGraphGuidance(fixture, port));
  await run("restricted graph is blocked without access token", () => testRestrictedGraphBlocked(fixture, port));
  await run("search renders around graph and node details/source refs", () => testSearchAroundAndDetails(fixture, port));
  await run("user session exposes graph rebuild button", () => testUserRebuildButton(fixture, port));
  await run("user graph panel auto-builds missing graph", () => testUserAutoBuildsMissingGraph(fixture, port));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await stopServer(server).catch(() => {});
  await cleanupFixture().catch((error) => {
    console.error(`[studio-graph-e2e] cleanup failed: ${error.message}`);
    failureCount += 1;
  });
}

if (failureCount > 0) process.exitCode = 1;

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failureCount += 1;
    console.error(`not ok - ${name}`);
    console.error(error?.stack || error);
  }
}

async function setupFixture() {
  accessBackup = await backupFile(ACCESS_GROUPS_PATH);
  await fs.mkdir(path.dirname(ACCESS_GROUPS_PATH), { recursive: true });
  await fs.writeFile(ACCESS_GROUPS_PATH, `${JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    groups: [],
    super: { enabled: false, passwordHash: "" }
  }, null, 2)}\n`, "utf8");

  const notebooks = await import("../server/notebooks.js");
  const access = await import("../server/accessControl.js");
  const graph = await import("../server/rag/graph/store.js");

  await access.createAccessGroup({
    id: ACCESS_GROUP_ID,
    name: "Studio E2E",
    description: "temporary group for Studio graph e2e"
  });
  await access.setGroupLevelPassword(ACCESS_GROUP_ID, 1, ACCESS_PASSWORD);
  const login = await access.loginAccess({ groupId: ACCESS_GROUP_ID, level: 1, password: ACCESS_PASSWORD });
  assert.ok(login?.token, "fixture access login should produce a token");

  const graphNotebook = await notebooks.createNotebook({
    name: `Studio Graph E2E ${Date.now()}`,
    description: "temporary Studio graph e2e notebook"
  });
  createdNotebookIds.push(graphNotebook.id);
  await notebooks.updateNotebookAccess(graphNotebook.id, { groups: [ACCESS_GROUP_ID], minLevel: 1 });
  const nodeIds = await seedGraph(graph, graphNotebook.id);

  const noGraphNotebook = await notebooks.createNotebook({
    name: `Studio No Graph E2E ${Date.now()}`,
    description: "temporary no-graph notebook"
  });
  createdNotebookIds.push(noGraphNotebook.id);
  await notebooks.updateNotebookAccess(noGraphNotebook.id, { groups: [ACCESS_GROUP_ID], minLevel: 1 });

  const restrictedNotebook = await notebooks.createNotebook({
    name: `Studio Restricted Graph E2E ${Date.now()}`,
    description: "temporary restricted graph notebook"
  });
  createdNotebookIds.push(restrictedNotebook.id);
  await notebooks.updateNotebookAccess(restrictedNotebook.id, { groups: [ACCESS_GROUP_ID], minLevel: 1 });
  await seedGraph(graph, restrictedNotebook.id);

  return {
    accessToken: login.token,
    graphNotebookId: graphNotebook.id,
    noGraphNotebookId: noGraphNotebook.id,
    restrictedNotebookId: restrictedNotebook.id,
    nodeIds
  };
}

async function seedGraph(graph, notebookId) {
  const db = await graph.openNotebookGraph(notebookId);
  const onboardingId = graph.upsertNode(db, {
    type: "Concept",
    label: "Onboarding Policy",
    summary: "Policy node used by the Studio graph e2e test.",
    confidence: 0.99,
    model: "studio-e2e",
    aliases: ["onboarding", "policy"]
  });
  const expenseId = graph.upsertNode(db, {
    type: "Form",
    label: "Expense Form",
    summary: "Source-backed form node used by the Studio graph e2e test.",
    confidence: 0.98,
    model: "studio-e2e",
    aliases: ["expense", "travel expense"]
  });
  const edgeId = graph.upsertEdge(db, {
    srcId: onboardingId,
    dstId: expenseId,
    type: "REQUIRES",
    label: "Onboarding requires the expense form.",
    confidence: 0.97,
    model: "studio-e2e"
  });
  graph.attachSourceRef(db, {
    kind: "node",
    refId: expenseId,
    documentId: "doc_studio_e2e",
    chunkIndex: 3,
    quote: "Travel expense source quote for Studio graph e2e."
  });
  graph.attachSourceRef(db, {
    kind: "edge",
    refId: edgeId,
    documentId: "doc_studio_e2e",
    chunkIndex: 4,
    quote: "Onboarding requires expense approval evidence."
  });
  return { onboardingId, expenseId, edgeId };
}

async function cleanupFixture() {
  const notebooks = await import("../server/notebooks.js");
  const graph = await import("../server/rag/graph/store.js");
  for (const notebookId of createdNotebookIds.reverse()) {
    graph.closeNotebookGraph(notebookId);
    await notebooks.deleteNotebook(notebookId).catch(() => {});
  }
  if (accessBackup !== undefined) await restoreFile(ACCESS_GROUPS_PATH, accessBackup);
}

async function testGraphRenders(fixture, port) {
  const page = await newAppPage(port, { accessToken: fixture.accessToken });
  try {
    await selectNotebook(page, fixture.graphNotebookId);
    await openGraphPanel(page);
    await page.locator("#kgCanvas canvas").first().waitFor({ state: "attached", timeout: 10000 });
    const stats = await page.locator("#kgStatsBar").textContent();
    assert.match(stats || "", /2/, "stats should include graph node count");
  } finally {
    await page.context().close();
  }
}

async function testNoGraphGuidance(fixture, port) {
  const page = await newAppPage(port, { accessToken: fixture.accessToken });
  try {
    await selectNotebook(page, fixture.noGraphNotebookId);
    await openGraphPanel(page);
    await page.locator("#kgCanvasEmpty").waitFor({ state: "visible", timeout: 10000 });
    const text = (await page.locator("#kgCanvasEmpty").textContent()) || "";
    assert.ok(text.trim().length > 0, "no-graph guidance should be visible");
  } finally {
    await page.context().close();
  }
}

async function testRestrictedGraphBlocked(fixture, port) {
  const page = await newAppPage(port);
  try {
    const result = await page.evaluate(async (notebookId) => {
      const response = await fetch(`/api/studio/graph/${encodeURIComponent(notebookId)}/stats`);
      let error = "";
      try { error = (await response.json()).error || ""; } catch { /* ignore */ }
      return { status: response.status, error };
    }, fixture.restrictedNotebookId);
    assert.equal(result.status, 401);
    assert.match(result.error, /required|authentication/i);
  } finally {
    await page.context().close();
  }
}

async function testSearchAroundAndDetails(fixture, port) {
  const page = await newAppPage(port, { accessToken: fixture.accessToken });
  try {
    await selectNotebook(page, fixture.graphNotebookId);
    await openGraphPanel(page);
    await page.locator("#kgSearchInput").fill("expense");
    await page.locator("#kgDetailBody").waitFor({ state: "visible", timeout: 10000 });
    const detail = (await page.locator("#kgDetailBody").textContent()) || "";
    assert.match(detail, /Expense Form/);
    assert.match(detail, /Travel expense source quote/);
  } finally {
    await page.context().close();
  }
}

async function testUserRebuildButton(fixture, port) {
  const page = await newAppPage(port, { accessToken: fixture.accessToken });
  try {
    await selectNotebook(page, fixture.graphNotebookId);
    await openGraphPanel(page);
    await page.locator("#kgRebuildButton").waitFor({ state: "visible", timeout: 10000 });
  } finally {
    await page.context().close();
  }
}

async function testUserAutoBuildsMissingGraph(fixture, port) {
  const notebook = await createNoGraphNotebookForAutoBuild();
  const page = await newAppPage(port, { accessToken: fixture.accessToken });
  try {
    await selectNotebook(page, notebook.id);
    await openGraphPanel(page);
    await page.waitForFunction(async ({ notebookId, accessToken }) => {
      const response = await fetch(`/api/studio/graph/${encodeURIComponent(notebookId)}/rebuild/status`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) return false;
      const payload = await response.json().catch(() => ({}));
      return Boolean(payload.job && ["running", "done"].includes(payload.job.status));
    }, { notebookId: notebook.id, accessToken: fixture.accessToken }, { timeout: 10000 });
  } finally {
    await page.context().close();
  }
}

async function createNoGraphNotebookForAutoBuild() {
  const notebooks = await import("../server/notebooks.js");
  const notebook = await notebooks.createNotebook({
    name: `Studio Auto Build E2E ${Date.now()}`,
    description: "temporary no-graph notebook for Studio graph auto-build e2e"
  });
  createdNotebookIds.push(notebook.id);
  await notebooks.updateNotebookAccess(notebook.id, { groups: [ACCESS_GROUP_ID], minLevel: 1 });
  return notebook;
}

async function newAppPage(port, { accessToken = "", adminToken = "" } = {}) {
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:${port}` });
  await context.addInitScript(({ accessToken, adminToken }) => {
    if (accessToken) sessionStorage.setItem("myai_access_token", accessToken);
    if (adminToken) sessionStorage.setItem("myai_admin_token", adminToken);
  }, { accessToken, adminToken });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("#studioGraphButton").waitFor({ state: "visible" });
  await page.evaluate(async ({ accessToken, adminToken }) => {
    const mod = await import("/modules/state.js");
    if (accessToken) {
      mod.state.access.token = accessToken;
      mod.state.access.authenticated = true;
    }
    if (adminToken) {
      mod.state.admin.token = adminToken;
      mod.state.admin.authenticated = true;
    }
  }, { accessToken, adminToken });
  await page.waitForTimeout(200);
  return page;
}

async function selectNotebook(page, notebookId) {
  await page.evaluate(async (id) => {
    const mod = await import("/modules/state.js");
    let room = mod.state.rooms.find((r) => r.id === mod.state.activeRoomId);
    if (!room) {
      room = mod.createRoom();
      mod.state.rooms = [room];
      mod.state.activeRoomId = room.id;
    }
    room.selectedNotebookId = id;
    room.updatedAt = new Date().toISOString();
    window.dispatchEvent(new CustomEvent("myai:renderrooms"));
  }, notebookId);
}

async function openGraphPanel(page) {
  await page.locator("#studioGraphButton").click();
  await page.locator("#studioGraphPanel").waitFor({ state: "visible" });
}

async function startServer(port) {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      ADMIN_TOKEN,
      ACCESS_TOKEN_SECRET: ACCESS_SECRET
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (process.env.STUDIO_GRAPH_E2E_DEBUG) process.stdout.write(`[server] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    if (process.env.STUDIO_GRAPH_E2E_DEBUG) process.stderr.write(`[server] ${chunk}`);
  });

  await waitForHttp(`http://127.0.0.1:${port}/`, 30000);
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function launchBrowser() {
  const launchOptions = { headless: true };
  try {
    return await chromium.launch(launchOptions);
  } catch (firstError) {
    for (const executablePath of browserExecutableCandidates()) {
      if (!fsSync.existsSync(executablePath)) continue;
      try {
        return await chromium.launch({ ...launchOptions, executablePath });
      } catch {
        // Try the next installed Chromium-family browser.
      }
    }
    throw new Error(
      `Could not launch Playwright Chromium. Run "npx playwright install chromium" or install Edge/Chrome. ${firstError.message}`
    );
  }
}

function browserExecutableCandidates() {
  return [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];
}

async function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready at ${url}: ${lastError?.message || "timeout"}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      srv.close(() => resolve(address.port));
    });
  });
}

async function backupFile(filePath) {
  try {
    return { exists: true, data: await fs.readFile(filePath) };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, data: null };
    throw error;
  }
}

async function restoreFile(filePath, backup) {
  if (!backup?.exists) {
    await fs.rm(filePath, { force: true }).catch(() => {});
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, backup.data);
}
