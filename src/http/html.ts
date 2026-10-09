/** HTML escaping for every dynamic value. Use `raw()` only for trusted, pre-escaped fragments. */
export class Raw {
  constructor(readonly html: string) {}
}

export function raw(html: string): Raw {
  return new Raw(html);
}

export function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Raw) return value.html;
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Tagged template: html`<p>${userText}</p>` escapes every interpolated value automatically. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (Array.isArray(v)) out += v.map((x) => esc(x)).join('');
      else out += esc(v);
    }
  });
  return new Raw(out);
}

export function joinRaw(items: Raw[]): Raw {
  return new Raw(items.map((i) => i.html).join(''));
}
