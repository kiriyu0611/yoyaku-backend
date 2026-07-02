# セットアップ手順

## 1. Twitch Developer Consoleでアプリ登録

1. https://dev.twitch.tv/console/apps にアクセスし、自分のTwitchアカウントでログイン
2. 「Register Your Application」を押す
3. 以下を入力
   - **Name**: 好きな名前（例: `my-yoyaku-bot`）※Twitch上で他と被らない名前にする
   - **OAuth Redirect URLs**: `http://localhost:3000/auth/twitch/callback`
     （`.env`の`TWITCH_REDIRECT_URI`と完全に一致させること）
   - **Category**: `Chat Bot` を選択
   - **Client Type**: `Confidential` を選択
4. 「Create」を押すと一覧にアプリが追加される
5. アプリの「Manage」を開き、
   - **Client ID** をコピー
   - 「New Secret」を押して **Client Secret** を発行・コピー
     （Secretは再表示できないので必ず控えておく）

## 2. 環境変数を設定

```bash
cd backend
cp .env.example .env
```

`.env`を開いて、さっき取得した値を入れる：

```
TWITCH_CLIENT_ID=（コピーしたClient ID）
TWITCH_CLIENT_SECRET=（コピーしたClient Secret）
TWITCH_REDIRECT_URI=http://localhost:3000/auth/twitch/callback
PORT=3000
FRONTEND_URL=http://localhost:5173
```

## 3. インストールして起動

```bash
npm install
npm start
```

`サーバー起動: http://localhost:3000` と表示されればOK。

## 4. Twitchアカウントと連携する

ブラウザで以下を開く：

```
http://localhost:3000/auth/twitch
```

自分のTwitchアカウントでログインし、権限の許可画面が出るので「Authorize」を押す。
これで
- チャットの読み取り（`user:read:chat`）
- チャットへの書き込み（`user:write:chat`）

が許可され、自動的にチャット監視が始まる。連携情報は`data.json`というファイルに保存され、
サーバーを再起動しても自動で再接続する（アクセストークンが切れそうになったら自動更新される）。

ログイン状態はブラウザのCookieで管理されるので、複数の配信者がそれぞれ`/auth/twitch`から
ログインすれば、それぞれ自分専用のキューを持てる（お互いのデータは混ざらない）。

## 動作確認

連携が終わったら、自分の配信のチャット欄（別アカウントか、Twitchのチャット画面から）で

```
!yoyaku
```

と打ってみて、サーバーのログに反応が出るか確認する。

**注意**：コマンドは`/`ではなく`!`で始めてください（`!yoyaku`）。`/`で始まるメッセージはTwitch自体が「特殊コマンド」として処理しようとしてしまい、認識できない場合はチャットに送信されずブロックされてしまうため。

## Webサービスとして公開する場合(次のステップ)

今はまだ`localhost`前提の設定になっています。誰でもログインだけで使える形にするには、

1. どこかのサーバー（Render, Railway, Fly.ioなど）にこのバックエンドをデプロイする
2. そのサーバーの実際のURL（`https://xxxxx.com`のような形）を`.env`の`TWITCH_REDIRECT_URI`に設定
3. Twitch Developer Console側の「OAuth Redirect URLs」も同じURLに更新
4. `NODE_ENV=production`を設定（Cookieのsecure属性が有効になる）

という作業が必要です。これは次のステップとして別途デプロイ手順書を用意します。

## 注意点・今の実装の制限

- **送信元アカウントについて**：チャットへの自動投稿は「配信者自身のアカウント」から送信されます。見た目上は配信者自身が発言しているように見えます。別人格の「botアカウント」から送りたい場合は、そのbot用の別Twitchアカウントで同じOAuth手順を踏み、そのアカウントのトークンを`senderId`に使う形に改修が必要です。
- **コマンドの表記ゆれ**：`src/eventsub.js`の`COMMANDS`に登録された文字列と完全一致した場合のみ反応します（例:「/よやく」のような表記は今は無反応）。増やしたい表記があれば配列に追加するだけで対応できます。
- **キューはメモリ上のみ**：予約キューの中身自体はサーバー再起動で消えます（連携情報は`data.json`に残るので再連携は不要）。配信をまたいで予約を持ち越したくない設計なら今のままで問題ありません。

