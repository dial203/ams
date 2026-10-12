/** Small internal helpers. Kept free of anything Hermes (React Native) lacks. */

const hasOwnProperty = Object.prototype.hasOwnProperty;

/** `Object.hasOwn` replacement (Hermes does not ship it). */
export function hasOwn(obj: object, key: string): boolean {
  return hasOwnProperty.call(obj, key);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Assigns an own enumerable property, safe for keys such as `__proto__` or `constructor`. */
export function setOwn<T>(obj: Record<string, T>, key: string, value: T): void {
  if (key === "__proto__") {
    Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    obj[key] = value;
  }
}

/** Number of Unicode code points (not UTF-16 code units) in a string. */
export function codePointLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // A high surrogate followed by a low surrogate is one code point.
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/** Compares two strings by Unicode code point. Returns negative, zero or positive. */
export function compareCodePoints(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(j)!;
    if (ca !== cb) return ca - cb;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  return (a.length - i) - (b.length - j);
}
