'use strict';
/**
 * کلاینت IPPanel Edge API
 * مستندات: https://ippanelcom.github.io/Edge-Document/docs/
 *   Base URL: https://edge.ippanel.com/v1
 *   Header:   Authorization: {API_KEY یا TOKEN}
 *   ارسال پترن:   POST /api/send  { sending_type: "pattern", from_number, code, recipients: ["+98..."], params: {...} }
 *   ارسال عادی:   POST /api/send  { sending_type: "webservice", from_number, message, params: { recipients: [...] } }
 *   اعتبار:       GET  /api/payment/credit/mine
 *   لیست پترن‌ها:  GET  /api/patterns?page=1&per_page=100
 */
const DEFAULT_BASE = 'https://edge.ippanel.com/v1';

class IPPanelError extends Error {
  constructor(message, { status, code, response } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.response = response;
  }
}

class IPPanel {
  constructor({ apiKey, baseUrl, fromNumber, timeout = 15000 } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.baseUrl = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
    this.fromNumber = IPPanel.formatSender(fromNumber);
    this.timeout = timeout;
  }

  /** شماره فرستنده باید به فرمت E.164 باشد: +983000505 */
  static formatSender(n) {
    let s = String(n || '').trim().replace(/[^\d+]/g, '');
    if (!s) return '';
    if (s.startsWith('+')) return s;
    if (s.startsWith('0098')) return '+' + s.slice(2);
    if (s.startsWith('98')) return '+' + s;
    if (s.startsWith('0')) return '+98' + s.slice(1);
    return '+98' + s;
  }

  async request(method, path, body) {
    if (!this.apiKey) throw new IPPanelError('کلید API پنل پیامک تنظیم نشده است.');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeout);
    let res;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: { Authorization: this.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new IPPanelError(e.name === 'AbortError' ? 'پاسخی از سرور پیامک دریافت نشد (Timeout).' : `خطا در اتصال به سرور پیامک: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
    let json = null;
    const raw = await res.text();
    try { json = JSON.parse(raw); } catch (e) { json = null; }
    const meta = (json && json.meta) || {};
    if (!res.ok || meta.status === false) {
      let msg = meta.message || `خطای ${res.status} از سرور پیامک`;
      if (meta.errors && typeof meta.errors === 'object') {
        const first = Object.values(meta.errors).flat()[0];
        if (first) msg += ` - ${first}`;
      }
      throw new IPPanelError(msg, { status: res.status, code: meta.message_code, response: json || raw });
    }
    return json;
  }

  /** ارسال پیامک پترن (فقط یک گیرنده در هر درخواست طبق مستندات) */
  async sendPattern({ code, recipient, params }) {
    const body = {
      sending_type: 'pattern',
      from_number: this.fromNumber,
      code: String(code || '').trim(),
      recipients: [recipient],
      params: params || {},
    };
    const out = await this.request('POST', '/api/send', body);
    return { ids: (out.data && out.data.message_outbox_ids) || [], response: out };
  }

  /** ارسال پیامک متنی (وب‌سرویس) به یک یا چند گیرنده */
  async sendText({ message, recipients, sendTime }) {
    const body = {
      sending_type: 'webservice',
      from_number: this.fromNumber,
      message: String(message || ''),
      params: { recipients },
    };
    if (sendTime) body.send_time = sendTime;
    const out = await this.request('POST', '/api/send', body);
    return { ids: (out.data && out.data.message_outbox_ids) || [], response: out };
  }

  async credit() {
    const out = await this.request('GET', '/api/payment/credit/mine');
    return out.data || {};
  }

  async patterns({ page = 1, perPage = 100, code } = {}) {
    let qs = `?page=${page}&per_page=${perPage}`;
    if (code) qs += `&filter[code]=${encodeURIComponent(code)}`;
    const out = await this.request('GET', `/api/patterns${qs}`);
    return { data: out.data || [], meta: out.meta || {} };
  }
}

module.exports = { IPPanel, IPPanelError, DEFAULT_BASE };
