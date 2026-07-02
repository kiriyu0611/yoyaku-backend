const WebSocket = require("ws");
const { subscribeChatMessages } = require("./twitchApi");

const EVENTSUB_WS_URL = "wss://eventsub.wss.twitch.tv/ws";

// コマンドの表記ゆれをここにまとめる。増やしたくなったら配列に足すだけでよい。
// 注意: Twitchは "/" で始まるメッセージを自分自身の特殊コマンドとして扱おうとするため、
// 未対応の "/" コマンドは実際にはチャットへ送信されずブロックされてしまう。
// そのため配信・ゲーム系チャットボットの標準的な作法である "!" を採用している。
const COMMANDS = {
  yoyaku: ["!yoyaku", "!予約"],
  torikeshi: ["!torikeshi", "!取り消し"],
  kakunin: ["!kakunin", "!確認"],
};

function matchCommand(text) {
  const t = text.trim();
  for (const [type, aliases] of Object.entries(COMMANDS)) {
    if (aliases.some((a) => t === a)) return type;
  }
  return null;
}

/**
 * EventSubへの接続を開始する。
 * onCommand(type, { login, displayName, messageId }) が各コマンド受信時に呼ばれる。
 * 接続が切れた場合は自動的に再接続を試みる。
 */
function connectEventSub({ clientId, accessToken, broadcasterId, userId, onCommand, onReady }) {
  let ws;
  let keepaliveTimer = null;

  function open(url = EVENTSUB_WS_URL) {
    ws = new WebSocket(url);

    ws.on("open", () => console.log("[EventSub] WebSocket接続を開始しました"));

    ws.on("message", async (raw) => {
      const payload = JSON.parse(raw.toString());
      const type = payload.metadata?.message_type;

      if (type === "session_welcome") {
        const sessionId = payload.payload.session.id;
        console.log("[EventSub] session_welcome 受信。チャット購読を登録します");
        try {
          await subscribeChatMessages({ clientId, accessToken, broadcasterId, userId, sessionId });
          console.log("[EventSub] チャット購読の登録に成功しました");
        } catch (err) {
          console.error("[EventSub] チャット購読の登録に失敗しました:", err.response?.data || err.message);
        }
        onReady?.();
      }

      if (type === "session_reconnect") {
        const newUrl = payload.payload.session.reconnect_url;
        console.log("[EventSub] 再接続を要求されました");
        const oldWs = ws;
        open(newUrl);
        setTimeout(() => oldWs.close(), 3000);
      }

      if (type === "notification") {
        const subType = payload.metadata.subscription_type;
        if (subType === "channel.chat.message") {
          const event = payload.payload.event;
          const commandType = matchCommand(event.message.text);
          console.log(
            `[Chat] ${event.chatter_user_login}: "${event.message.text}"${commandType ? ` → コマンド判定: ${commandType}` : " → コマンドではない"}`
          );
          if (commandType) {
            onCommand(commandType, {
              login: event.chatter_user_login,
              displayName: event.chatter_user_name,
              messageId: event.message_id,
            });
          }
        }
      }
    });

    ws.on("close", () => {
      console.log("[EventSub] 接続が切れました。5秒後に再接続します");
      clearInterval(keepaliveTimer);
      setTimeout(() => open(), 5000);
    });

    ws.on("error", (err) => console.error("[EventSub] エラー:", err.message));
  }

  open();
}

module.exports = { connectEventSub, matchCommand, COMMANDS };
