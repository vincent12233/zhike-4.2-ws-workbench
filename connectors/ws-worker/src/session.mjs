export const STATES = Object.freeze({
  DISCONNECTED: '未连接',
  WAITING_LOGIN: '等待登录',
  LOGGING_IN: '登录中',
  CONNECTED: '已连接',
  SESSION_EXPIRED: '会话过期',
  FAILED: '连接失败',
  RECONNECTING: '正在重连',
});

const EVENTS = Object.freeze({
  open: STATES.WAITING_LOGIN,
  login: STATES.LOGGING_IN,
  connected: STATES.CONNECTED,
  'session-expired': STATES.SESSION_EXPIRED,
  failed: STATES.FAILED,
  retry: STATES.RECONNECTING,
  close: STATES.DISCONNECTED,
});

export class ConnectorSession {
  #accountId;
  #state = STATES.DISCONNECTED;
  #attempt = 0;
  #lastError = '';
  #updatedAt = new Date().toISOString();

  constructor(accountId = '') {
    this.#accountId = String(accountId || '').trim();
  }

  transition(event, details = {}) {
    const next = EVENTS[event];
    if (!next) throw new Error(`unsupported connector event: ${event}`);
    this.#state = next;
    this.#attempt = next === STATES.RECONNECTING ? this.#attempt + 1 : next === STATES.CONNECTED ? 0 : this.#attempt;
    this.#lastError = next === STATES.FAILED || next === STATES.SESSION_EXPIRED ? String(details.reason || details.message || '') : '';
    this.#updatedAt = new Date().toISOString();
    return this.status();
  }

  status() {
    return {
      accountId: this.#accountId,
      state: this.#state,
      attempt: this.#attempt,
      lastError: this.#lastError,
      updatedAt: this.#updatedAt,
    };
  }
}
