const jwt = require("jsonwebtoken");
const cookie = require("cookie");

const COOKIE_NAME = "session";
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30日

function signSessionCookie(broadcasterId, secret) {
  const token = jwt.sign({ broadcasterId }, secret, { expiresIn: COOKIE_MAX_AGE_SEC });
  return cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_SEC,
    path: "/",
    // 本番でhttps化したら secure: true にすること(このリポジトリではNODE_ENVで自動切り替え)
    secure: process.env.NODE_ENV === "production",
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
