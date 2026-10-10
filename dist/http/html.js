"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Raw = void 0;
exports.raw = raw;
exports.esc = esc;
exports.html = html;
exports.joinRaw = joinRaw;
/** HTML escaping for every dynamic value. Use `raw()` only for trusted, pre-escaped fragments. */
class Raw {
    html;
    constructor(html) {
        this.html = html;
    }
}
exports.Raw = Raw;
function raw(html) {
    return new Raw(html);
}
function esc(value) {
    if (value === null || value === undefined)
        return '';
    if (value instanceof Raw)
        return value.html;
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/** Tagged template: html`<p>${userText}</p>` escapes every interpolated value automatically. */
function html(strings, ...values) {
    let out = '';
    strings.forEach((s, i) => {
        out += s;
        if (i < values.length) {
            const v = values[i];
            if (Array.isArray(v))
                out += v.map((x) => esc(x)).join('');
            else
                out += esc(v);
        }
    });
    return new Raw(out);
}
function joinRaw(items) {
    return new Raw(items.map((i) => i.html).join(''));
}
