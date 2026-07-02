const { QueueManager } = require("./queueManager");
const { connectEventSub } = require("./eventsub");
const { getValidAccessToken } = require("./tokenManager");
const twitch = require("./twitchApi");

/**
 * サーバープロセスが生きている間だけ保持する「実行中の状態」。
 * DB(db.js)は永続データ(トークンなど)、こちらはメモリ上の一時データ(キューの中身・WebSocket接続)を扱う。
 *
 * @type {Map<string, { queue: QueueManager, listening: boolean }>}
 */
const runtimes = new Map();

function getRuntime(broadcasterId) {
  if (!runtimes.has(broadcasterId)) {
    runtimes.set(broadcasterId, { queue: new QueueManager(), listening: false });
  }
  return runtimes.get(broadcasterId);
}

/**
 * 指定した配信者のチャット監視を開始する(すでに開始済みなら何もしない)。
 * io: Socket.ioサーバー本体。broadcasterId名のルームに向けて更新を送る。
 */
function ensureChatListener(streamer, { io, clientId, clientSecret }) {
  const runtime = getRuntime(streamer.broadcaster_id);
  if (runtime.listening) return;
  runtime.listening = true;

  const room = streamer.broadcaster_id;
  const broadcastQueue = () => io.to(room).emit("queue:state", { queue: runtime.queue.list(), size: runtime.queue.size() });
  const pushActivity = (entry) => io.to(room).emit("activity:new", { id: `${Date.now()}-${Math.random()}`, time: Date.now(), ...entry });

  connectEventSub({
    clientId,
    // 接続開始時点の最新トークンを渡す。長時間の配信で切れた場合は
    // ws再接続のタイミングでは更新していない点は既知の制限(TODO参照)。
    accessToken: streamer.access_token,
    broadcasterId: streamer.broadcaster_id,
    userId: streamer.broadcaster_id,
    onReady: () => {
      console.log(`[Twitch] #${streamer.login} のチャット監視を開始しました`);
      io.to(room).emit("connection:ready", { channel: streamer.login });
    },
    onCommand: async (type, { login, displayName, messageId }) => {
      const queue = runtime.queue;

      if (type === "yoyaku") {
        if (queue.add(login, displayName)) {
          console.log(`[Queue] ${displayName} を予約に追加しました(現在${queue.size()}人待ち)`);
          pushActivity({ type: "joined", username: displayName, detail: "予約に追加されました" });
          broadcastQueue();
        } else {
          console.log(`[Queue] ${displayName} は既に予約済みのため無視しました`);
        }
      }

      if (type === "torikeshi") {
        if (queue.remove(login)) {
          console.log(`[Queue] ${displayName} の予約を取り消しました(現在${queue.size()}人待ち)`);
          pushActivity({ type: "cancelled", username: displayName, detail: "予約を取り消しました" });
          broadcastQueue();
        } else {
          console.log(`[Queue] ${displayName} は予約されていなかったため無視しました`);
        }
      }

      if (type === "kakunin") {
        const pos = queue.positionOf(login);
        // reply_parent_message_id を使うとTwitch側が返信先を自動表示するので、
        // ここで自分から "@displayName" を付けると二重表示になってしまう。そのため付けない。
        const message = pos ? `現在${pos}番目です！` : `まだ予約されていません`;
        pushActivity({ type: "checked", username: displayName, detail: pos ? `現在${pos}番目です` : "未予約でした" });
        try {
          const accessToken = await getValidAccessToken(streamer, { clientId, clientSecret });
          await twitch.sendChatMessage({
            clientId,
            accessToken,
            broadcasterId: streamer.broadcaster_id,
            senderId: streamer.broadcaster_id,
            message,
            replyParentMessageId: messageId,
          });
        } catch (err) {
          console.error(`[Twitch] #${streamer.login} への返信に失敗:`, err.response?.data || err.message);
        }
      }
    },
  });
}

/** ホストが「呼び出す」を押した時の処理 */
async function callViewer(streamer, { login, displayName }, { clientId, clientSecret, io }) {
  const runtime = getRuntime(streamer.broadcaster_id);
  const room = streamer.broadcaster_id;

  runtime.queue.callOut(login);
  io.to(room).emit("queue:state", { queue: runtime.queue.list(), size: runtime.queue.size() });
  io.to(room).emit("activity:new", {
    id: `${Date.now()}-${Math.random()}`,
    time: Date.now(),
    type: "called",
    username: displayName,
    detail: "呼び出されました",
  });

  const accessToken = await getValidAccessToken(streamer, { clientId, clientSecret });
  await twitch.sendChatMessage({
    clientId,
    accessToken,
    broadcasterId: streamer.broadcaster_id,
    senderId: streamer.broadcaster_id,
    message: `@${displayName} 呼ばれました！`,
  });
}

module.exports = { getRuntime, ensureChatListener, callViewer };
