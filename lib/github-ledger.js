const { Buffer } = require("node:buffer");

const GH_API = "https://api.github.com";

function encodeRepoPath(filepath) {
  return String(filepath)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

/**
 * @param {string} token
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function ghFetch(token, path, init = {}) {
  const url = path.startsWith("http") ? path : `${GH_API}${path}`;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${token}`,
    "User-Agent": "ari-expense-ledger",
    ...(init.headers || {}),
  };
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body && body.message
        ? body.message
        : `GitHub API ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/**
 * @returns {{ content: string; sha: string } | null}
 */
async function getRawFile(token, owner, repo, filepath) {
  const path = `/repos/${owner}/${repo}/contents/${encodeRepoPath(filepath)}`;
  try {
    const meta = await ghFetch(token, path);
    if (!meta || !meta.content || meta.type !== "file") return null;
    const content = Buffer.from(meta.content.replace(/\n/g, ""), "base64").toString("utf8");
    return { content, sha: meta.sha };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function putRawFile(token, owner, repo, filepath, message, bodyText, sha) {
  const path = `/repos/${owner}/${repo}/contents/${encodeRepoPath(filepath)}`;
  const payload = {
    message,
    content: Buffer.from(bodyText, "utf8").toString("base64"),
  };
  if (sha) payload.sha = sha;
  return ghFetch(token, path, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

const DEFAULT_LEDGER = {
  version: 1,
  updatedAt: null,
  entries: [],
};

function normalizeLedger(parsed) {
  if (!parsed || typeof parsed !== "object") return { ...DEFAULT_LEDGER, entries: [] };
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  return {
    version: typeof parsed.version === "number" ? parsed.version : 1,
    updatedAt: parsed.updatedAt || null,
    entries,
  };
}

/**
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {string} ledgerPath
 */
async function readLedger(token, owner, repo, ledgerPath) {
  const raw = await getRawFile(token, owner, repo, ledgerPath);
  if (!raw) {
    return { ledger: { ...DEFAULT_LEDGER }, sha: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.content);
  } catch {
    parsed = null;
  }
  return { ledger: normalizeLedger(parsed), sha: raw.sha };
}

/**
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 */
async function readCategoriesConfig(token, owner, repo) {
  const raw = await getRawFile(token, owner, repo, "categories.json");
  if (!raw) {
    return { categories: [{ name: "Outros", keywords: [] }], fallbackCategory: "Outros" };
  }
  try {
    return JSON.parse(raw.content);
  } catch {
    return { categories: [{ name: "Outros", keywords: [] }], fallbackCategory: "Outros" };
  }
}

/**
 * Append many entries in one commit (409 retry).
 * @param {object} params
 * @param {string} params.token
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string} params.ledgerPath
 * @param {object[]} params.entries
 * @param {number} [params.maxAttempts]
 */
async function appendLedgerEntries({
  token,
  owner,
  repo,
  ledgerPath,
  entries: newEntries,
  maxAttempts = 4,
}) {
  if (!Array.isArray(newEntries) || newEntries.length === 0) {
    throw new Error("entries must be a non-empty array");
  }
  let lastErr = null;
  const count = newEntries.length;
  const preview = newEntries.slice(0, 3).map((e) => e.description).join(", ");
  const msg =
    count <= 3
      ? `ledger: add ${preview}`
      : `ledger: bulk add ${count} items (${preview}…)`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { ledger, sha } = await readLedger(token, owner, repo, ledgerPath);
    const next = {
      ...ledger,
      updatedAt: new Date().toISOString(),
      entries: [...ledger.entries, ...newEntries],
    };
    const bodyText = JSON.stringify(next, null, 2) + "\n";
    try {
      await putRawFile(token, owner, repo, ledgerPath, msg, bodyText, sha);
      return next;
    } catch (e) {
      lastErr = e;
      const conflict =
        e.status === 409 ||
        (typeof e.message === "string" && /sha/i.test(e.message));
      if (!conflict) throw e;
    }
  }
  throw lastErr || new Error("Failed to append after retries");
}

/**
 * @param {object} params
 */
async function appendLedgerEntry(params) {
  return appendLedgerEntries({
    ...params,
    entries: [params.entry],
  });
}

module.exports = {
  readLedger,
  readCategoriesConfig,
  appendLedgerEntry,
  appendLedgerEntries,
  ghFetch,
};
