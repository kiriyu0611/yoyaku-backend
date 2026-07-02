const jwt = require("jsonwebtoken");
const cookie = require("cookie");

const COOKIE_NAME = "session";
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30日

function signSessionCookie(broadcasterId, secret) {
  const token = jwt.sign({ broadcasterId }, secret, { expiresIn: COOKIE_MAX_AGE_SEC });
  const isProd = process.env.NODE_ENV === "production";
  return cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true,
    // 本番はフロントとバックエンドが別ドメイン(onrender.comの別サブドメイン)になるため、
    // クロスサイトのfetch/socket.io接続でもCookieが送られるよう sameSite: "none" にする必要がある。
    // ただしSameSite=NoneはSecure(https)必須なので、ローカル開発(http)ではlaxのままにする。
    sameSite: isProd ? "none" : "lax",
    maxAge: COOKIE_MAX_AGE_SEC,
    path: "/",
    secure: isProd,
  });
}

function readBroadcasterIdFromCookieHeader(cookieHeader, secret) {
  if (!cookieHeader) return null;
  const parsed = cookie.parse(cookieHeader);
  const token = parsed[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret);
    return payload.broadcasterId;
  } catch {
    return null;
  }
}

/** Express用ミドルウェア。req.broadcasterId をセットする。無ければ401。 */
function requireAuth(secret) {
  return (req, res, next) => {
    const broadcasterId = readBroadcasterIdFromCookieHeader(req.headers.cookie, secret);
    if (!broadcasterId) return res.status(401).json({ error: "not_logged_in" });
    req.broadcasterId = broadcasterId;
    next();
  };
}

module.exports = { signSessionCookie, readBroadcasterIdFromCookieHeader, requireAuth, COOKIE_NAME };
