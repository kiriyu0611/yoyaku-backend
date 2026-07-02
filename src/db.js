const crypto = require("crypto");
const { Pool } = require("pg");

// SupabaseはSSL接続が必須。証明書の検証はSupabase側の仕様に合わせて緩めている。
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function genOverlayToken() {
  return crypto.randomBytes(16).toString("hex");
}

/** OAuth成功時に呼ぶ。新規なら作成、既存なら情報を上書きする */
async function upsertStreamer({ broadcasterId, login, displayName, accessToken, refreshToken, expiresIn }) {
  const tokenExpiresAt = Date.now() + expiresIn * 1000;
  const existing = await getStreamerById(broadcasterId);
  const overlayToken = existing?.overlay_token || genOverlayToken();
  const createdAt = existing?.created_at || Date.now();

  await pool.query(
    `insert into streamers (broadcaster_id, login, display_name, access_token, refresh_token, token_expires_at, overlay_token, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (broadcaster_id) do update set
       login = excluded.login,
       display_name = excluded.display_name,
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       token_expires_at = excluded.token_expires_at`,
    [broadcasterId, login, displayName, accessToken, refreshToken, tokenExpiresAt, overlayToken, createdAt]
  );

  return getStreamerById(broadcasterId);
}

async function updateTokens(broadcasterId, { accessToken, refreshToken, expiresIn }) {
  const tokenExpiresAt = Date.now() + expiresIn * 1000;
  await pool.query(
    `update streamers set access_token=$1, refresh_token=$2, token_expires_at=$3 where broadcaster_id=$4`,
    [accessToken, refreshToken, tokenExpiresAt, broadcasterId]
  );
}

async function getStreamerById(broadcasterId) {
  const { rows } = await pool.query(`select * from streamers where broadcaster_id = $1`, [broadcasterId]);
  return rows[0] || null;
}

async function getStreamerByOverlayToken(token) {
  const { rows } = await pool.query(`select * from streamers where overlay_token = $1`, [token]);
  return rows[0] || null;
}

async function getAllStreamers() {
  const { rows } = await pool.query(`select * from streamers`);
  return rows;
}

module.exports = {
  upsertStreamer,
  updateTokens,
  getStreamerById,
  getStreamerByOverlayToken,
  getAllStreamers,
};
