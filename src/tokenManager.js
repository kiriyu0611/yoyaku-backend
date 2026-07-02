const twitch = require("./twitchApi");
const db = require("./db");

// 有効期限の5分前になったら早めに更新しておく(ギリギリで通信するとタイミング次第で失敗するため)
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * 配信者のアクセストークンが有効期限切れ間近なら更新し、常に使えるトークンを返す。
 * DBの中身も一緒に更新する。
 */
async function getValidAccessToken(streamer, { clientId, clientSecret }) {
  const isExpiringSoon = Date.now() + REFRESH_MARGIN_MS >= streamer.token_expires_at;
  if (!isExpiringSoon) return streamer.access_token;

  console.log(`[Token] #${streamer.login} のトークンを更新します`);
  const data = await twitch.refreshToken({
    clientId,
    clientSecret,
    refreshToken: streamer.refresh_token,
  });

  await db.updateTokens(streamer.broadcaster_id, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  });

  // 呼び出し元が持っているstreamerオブジェクトも最新化しておく
  streamer.access_token = data.access_token;
  streamer.refresh_token = data.refresh_token;
  streamer.token_expires_at = Date.now() + data.expires_in * 1000;

  return streamer.access_token;
}

module.exports = { getValidAccessToken };
