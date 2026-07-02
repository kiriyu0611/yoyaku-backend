require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const cookie = require("cookie");
const { Server } = require("socket.io");

const twitch = require("./twitchApi");
const db = require("./db");
const auth = require("./auth");
const { getRuntime, ensureChatListener, callViewer } = require("./runtimeManager");

const {
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  TWITCH_REDIRECT_URI,
  SESSION_SECRET,
  PORT = 3000,
  FRONTEND_URL = "http://localhost:5173",
} = process.env;

const twitchCreds = { clientId: TWITCH_CLIENT_ID, clientSecret: TWITCH_CLIENT_SECRET };

const app = express();
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

// UptimeRobot等の外部監視サービスがここに定期アクセスすることで、
// Renderの無料プランが「非アクティブ」と判断してスリープするのを防ぐ。
app.get("/health", (req, res) => res.status(200).send("ok"));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: FRONTEND_URL, credentials: true } });

// ── OAuth ──────────────────────────────────────────
app.get("/auth/twitch", (req, res) => {
  const url = twitch.buildAuthorizeUrl({ clientId: TWITCH_CLIENT_ID, redirectUri: TWITCH_REDIRECT_URI });
  res.redirect(url);
});

app.get("/auth/twitch/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.status(400).send("Twitch認可に失敗しました。ブラウザを閉じてやり直してください。");
  }
  try {
    const tokenData = await twitch.exchangeCodeForToken({
      clientId: TWITCH_CLIENT_ID,
      clientSecret: TWITCH_CLIENT_SECRET,
      redirectUri: TWITCH_REDIRECT_URI,
      code,
    });
    const me = await twitch.getMyUser({ clientId: TWITCH_CLIENT_ID, accessToken: tokenData.access_token });

    const streamer = await db.upsertStreamer({
      broadcasterId: me.id,
      login: me.login,
      displayName: me.display_name,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
    });

    ensureChatListener(streamer, { io, ...twitchCreds });

    const setCookieHeader = auth.signSessionCookie(streamer.broadcaster_id, SESSION_SECRET);
    res.setHeader("Set-Cookie", setCookieHeader);
    res.redirect(FRONTEND_URL);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("トークン取得に失敗しました。サーバーのログを確認してください。");
  }
});

app.post("/auth/logout", (req, res) => {
  res.setHeader("Set-Cookie", cookie.serialize(auth.COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 }));
  res.json({ ok: true });
});

// ── ログイン中の配信者向けAPI ──────────────────────────
app.get("/api/me", auth.requireAuth(SESSION_SECRET), async (req, res) => {
  const streamer = await db.getStreamerById(req.broadcasterId);
  if (!streamer) return res.status(404).json({ error: "not_found" });
  res.json({
    login: streamer.login,
    displayName: streamer.display_name,
    // オーバーレイ画面はフロントエンド(Viteアプリ)側の /overlay/:token ルートで表示するため、
    // バックエンド自身のURLではなく FRONTEND_URL を基準にする
    overlayUrl: `${FRONTEND_URL}/overlay/${streamer.overlay_token}`,
  });
});

app.get("/api/queue", auth.requireAuth(SESSION_SECRET), (req, res) => {
  const runtime = getRuntime(req.broadcasterId);
  res.json({ queue: runtime.queue.list(), size: runtime.queue.size() });
});

// ── オーバーレイ用の公開API(ログイン不要・秘密トークンで判定) ──
app.get("/api/overlay/:token/state", async (req, res) => {
  const streamer = await db.getStreamerByOverlayToken(req.params.token);
  if (!streamer) return res.status(404).json({ error: "invalid_token" });
  const runtime = getRuntime(streamer.broadcaster_id);
  res.json({ queue: runtime.queue.list(), size: runtime.queue.size() });
});

// ── Socket.io ──────────────────────────────────────
// ホスト管理画面: Cookie(JWT)で本人確認して、自分の配信専用ルームに入る
// オーバーレイ画面: 接続時に ?overlayToken=xxx を渡してもらい、対応するルームに入る(読み取り専用)
io.use(async (socket, next) => {
  const overlayToken = socket.handshake.query.overlayToken;
  console.log(`[Socket] 接続試行 overlayToken=${overlayToken || "(なし)"}`);
  if (overlayToken) {
    const streamer = await db.getStreamerByOverlayToken(overlayToken);
    if (!streamer) {
      console.log(`[Socket] overlayTokenが無効です: ${overlayToken}`);
      return next(new Error("invalid_overlay_token"));
    }
    socket.data.role = "overlay";
    socket.data.broadcasterId = streamer.broadcaster_id;
    console.log(`[Socket] overlayとして接続成功 broadcasterId=${streamer.broadcaster_id}`);
    return next();
  }

  const broadcasterId = auth.readBroadcasterIdFromCookieHeader(socket.handshake.headers.cookie, SESSION_SECRET);
  if (!broadcasterId) {
    console.log("[Socket] Cookie認証にも失敗しました");
    return next(new Error("not_logged_in"));
  }
  socket.data.role = "host";
  socket.data.broadcasterId = broadcasterId;
  console.log(`[Socket] hostとして接続成功 broadcasterId=${broadcasterId}`);
  next();
});

io.on("connection", (socket) => {
  const { broadcasterId, role } = socket.data;
  socket.join(broadcasterId);

  const runtime = getRuntime(broadcasterId);
  socket.emit("queue:state", { queue: runtime.queue.list(), size: runtime.queue.size() });

  if (role !== "host") return; // オーバーレイ画面は読み取り専用。呼び出し操作はホストのみ許可

  socket.on("viewer:call", async ({ login, displayName }) => {
    const streamer = await db.getStreamerById(broadcasterId);
    if (!streamer) return;
    try {
      await callViewer(streamer, { login, displayName }, { io, ...twitchCreds });
    } catch (err) {
      console.error(`[Twitch] #${streamer.login} の呼び出し送信に失敗:`, err.response?.data || err.message);
    }
  });
});

// ── 起動時: 既に連携済みの配信者全員のチャット監視を再開する ──
(async () => {
  const streamers = await db.getAllStreamers();
  for (const streamer of streamers) {
    ensureChatListener(streamer, { io, ...twitchCreds });
  }
})();

server.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
});
