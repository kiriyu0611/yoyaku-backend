/**
 * 予約キューの状態管理
 * Twitchのユーザーログイン名(login)は常に小文字なので、それをキーにして
 * 大文字小文字を気にせず「1人1枠」の重複チェックができるようにしている。
 */

class QueueManager {
  constructor() {
    /** @type {Map<string, {login: string, displayName: string, joinedAt: number}>} */
    this.entries = new Map();
    this.order = []; // login のリスト。並び順(先着順)を保持する
  }

  /** 予約に追加。すでに並んでいたら false を返す(二重予約防止) */
  add(login, displayName) {
    const key = login.toLowerCase();
    if (this.entries.has(key)) return false;
    this.entries.set(key, { login: key, displayName, joinedAt: Date.now() });
    this.order.push(key);
    return true;
  }

  /** 予約を取り消す。並んでいなければ false */
  remove(login) {
    const key = login.toLowerCase();
    if (!this.entries.has(key)) return false;
    this.entries.delete(key);
    this.order = this.order.filter((k) => k !== key);
    return true;
  }

  /** 呼び出し済みとしてキューから外す(removeと同じ処理だが意図を分けて命名) */
  callOut(login) {
    return this.remove(login);
  }

  /** 現在の順番(1始まり)を返す。並んでいなければ null */
  positionOf(login) {
    const key = login.toLowerCase();
    const idx = this.order.indexOf(key);
    return idx === -1 ? null : idx + 1;
  }

  isQueued(login) {
    return this.entries.has(login.toLowerCase());
  }

  /** 先頭から並んでいる順のリストを返す */
  list() {
    return this.order.map((key) => this.entries.get(key));
  }

  size() {
    return this.order.length;
  }
}

module.exports = { QueueManager };
