const axios = require("axios");

const HELIX = "https://api.twitch.tv/helix";
const OAUTH = "https://id.twitch.tv/oauth2";

// このアプリが必要とするスコープ。個人用ツールなので「自分のチャットを読む/自分として書き込む」の2つだけで足りる。
const SCOPES = ["user:read:chat", "user:write:chat"];

function buildAuthorizeUrl({ clientId, redirectUri }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
  });
  return `${OAUTH}/authorize?${params.toString()}`;
}

async function exchangeCodeForToken({ clientId, clientSecret, redirectUri, code }) {
  const res = await axios.post(`${OAUTH}/token`, null, {
    params: {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    },
  });
  return res.data; // { access_token, refresh_token, expires_in, ... }
}

async function refreshToken({ clientId, clientSecret, refreshToken: token }) {
  const res = await axios.post(`${OAUTH}/token`, null, {
    params: {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: token,
      grant_type: "refresh_token",
    },
  });
  return res.data;
}

async function getMyUser({ clientId, accessToken }) {
  const res = await axios.get(`${HELIX}/users`, {
    headers: { "Client-Id": clientId, Authorization: `Bearer ${accessToken}` },
  });
  return res.data.data[0]; // { id, login, display_name, ... }
}

/**
 * チャットにメッセージを送信する。
 * broadcasterId / senderId は基本的に配信者自身のuser idを渡す(自分として発言する)。
 * replyParentMessageId を渡すと、そのメッセージへの返信として表示される(!kakuninで使用)。
 */
async function sendChatMessage({ clientId, accessToken, broadcasterId, senderId, message, replyParentMessageId }) {
  const body = {
    broadcaster_id: broadcasterId,
    sender_id: senderId,
    message,
  };
  if (replyParentMessageId) body.reply_parent_message_id = replyParentMessageId;

  const res = await axios.post(`${HELIX}/chat/messages`, body, {
    headers: {
      "Client-Id": clientId,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  return res.data;
}

/** EventSub WebSocketセッションに対して、チャットメッセージ受信の購読を登録する */
async function subscribeChatMessages({ clientId, accessToken, broadcasterId, userId, sessionId }) {
  const res = await axios.post(
    `${HELIX}/eventsub/subscriptions`,
    {
      type: "channel.chat.message",
      version: "1",
      condition: { broadcaster_user_id: broadcasterId, user_id: userId },
      transport: { method: "websocket", session_id: sessionId },
    },
    {
      headers: {
        "Client-Id": clientId,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );
  return res.data;
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshToken,
  getMyUser,
  sendChatMessage,
  subscribeChatMessages,
};
