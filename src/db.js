const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// better-sqlite3はWindows環境でビルドツール(Python等)が必要になり、
// 初心者にはインストールの壁が高いため、あえて「ただのJSONファイル」で保存する方式にしている。
// 配信者の人数が数百人規模になるまでは実用上まったく問題ない。
const DATA_FILE = path.join(__dirname, "..", "data.json");

function loadAll() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveAll(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function genOverlayToken() {
  return crypto.randomBytes(16).toString("hex");
}

/** OAuth成功時に呼ぶ。新規なら作成、既存なら情報を上書きする */
function upsertStreamer({ broadcasterId, login, displayName, accessToken, refreshToken, expiresIn }) {
  const data = loadAll();
  const tokenExpiresAt = Date.now() + expiresIn * 1000;
  const existing = data[broadcasterId];

  data[broadcasterId] = {
    broadcaster_id: broadcasterId,
    login,
    display_name: displayName,
    access_token: accessToken,
    refresh_token: refreshToken,
    token_expires_at: tokenExpiresAt,
    overlay_token: existing?.overlay_token || genOverlayToken(),
    created_at: existing?.created_at || Date.now(),
  };

  saveAll(data);
  return data[broadcasterId];
}

function updateTokens(broadcasterId, { accessToken, refreshToken, expiresIn }) {
  const data = loadAll();
  if (!data[broadcasterId]) return;
  data[broadcasterId].access_token = accessToken;
  data[broadcasterId].refresh_token = refreshToken;
  data[broadcasterId].token_expires_at = Date.now() + expiresIn * 1000;
  saveAll(data);
}

function getStreamerById(broadcasterId) {
  const data = loadAll();
  return data[broadcasterId] || null;
}

function getStreamerByOverlayToken(token) {
  const data = loadAll();
  return Object.values(data).find((s) => s.overlay_token === token) || null;
}

function getAllStreamers() {
  return Object.values(loadAll());
}

module.exports = {
  upsertStreamer,
  updateTokens,
  getStreamerById,
  getStreamerByOverlayToken,
  getAllStreamers,
};
