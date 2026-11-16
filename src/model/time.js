'use strict';
function rational(num, den = 1n) {
  num = BigInt(num); den = BigInt(den);
  if (den <= 0n) throw new RangeError('Denominator must be positive');
  let a = num < 0n ? -num : num, b = den;
  while (b) [a, b] = [b, a % b];
  const gcd = a || 1n;
  return { num: String(num / gcd), den: String(den / gcd) };
}
function parse(t) {
  if (!t || typeof t.num !== 'string' || typeof t.den !== 'string' || !/^-?\d+$/.test(t.num) || !/^\d+$/.test(t.den)) throw new TypeError('Invalid rational');
  return rational(t.num, t.den);
}
function add(a, b) { a = parse(a); b = parse(b); return rational(BigInt(a.num) * BigInt(b.den) + BigInt(b.num) * BigInt(a.den), BigInt(a.den) * BigInt(b.den)); }
function sub(a, b) { b = parse(b); return add(a, rational(-BigInt(b.num), b.den)); }
function compare(a, b) { a = parse(a); b = parse(b); const v = BigInt(a.num) * BigInt(b.den) - BigInt(b.num) * BigInt(a.den); return v < 0n ? -1 : v > 0n ? 1 : 0; }
function frameTime(frame, fps) { fps = parse(fps); if (BigInt(fps.num) <= 0n) throw new RangeError('Invalid frame rate'); return rational(BigInt(frame) * BigInt(fps.den), fps.num); }
function sampleCeil(time, rate) {
  time = parse(time); rate = BigInt(rate);
  if (rate <= 0n) throw new RangeError('Invalid sample rate');
  const n = BigInt(time.num) * rate, d = BigInt(time.den);
  return n >= 0n ? (n + d - 1n) / d : n / d;
}
function onGrid(time, step) { time = parse(time); step = parse(step); return (BigInt(time.num) * BigInt(step.den)) % (BigInt(time.den) * BigInt(step.num)) === 0n; }
module.exports = { rational, parse, add, sub, compare, frameTime, sampleCeil, onGrid };
