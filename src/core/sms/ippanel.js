/**
 * کلاینت API پنل پیامکی IPPanel (Edge API)
 * مستندات: https://ippanelcom.github.io/Edge-Document/docs/
 */
const https = require('https');
const { URL } = require('url');

class IppanelClient {
  /**
   * @param {string} apiKey کلید دسترسی (Access Key) یا توکن
   * @param {string} baseUrl پیش‌فرض https://edge.ippanel.com/v1
   */
  constructor(apiKey, baseUrl = 'https://edge.ippanel.com/v1') {
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || 'https://edge.ippanel.com/v1').replace(/\/+$/, '');
  }

  /** درخواست POST با بدنه JSON */
  async post(pathname, body) {
    const url = new URL(this.baseUrl + pathname);
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: this.apiKey,
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 20000,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            let json = null;
            try {
              json = JSON.parse(data);
            } catch (_) {}
            resolve({ statusCode: res.statusCode, body: json, raw: data });
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('مهلت اتصال به سرور پیامکی تمام شد'));
      });
      req.write(payload);
      req.end();
    });
  }

  /**
   * ارسال پیامک با الگو (Pattern)
   * @param {object} opts { from_number, code, recipients: [], params: {} }
   */
  async sendPattern({ from_number, code, recipients, params }) {
    return this.post('/api/send', {
      sending_type: 'pattern',
      from_number,
      code,
      recipients,
      params: params || {},
    });
  }

  /** دریافت لیست الگوها (اختیاری) */
  async listPatterns() {
    return this.post('/api/pattern/list', {});
  }
}

module.exports = IppanelClient;
