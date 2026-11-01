// One function per scenario slug. Each drives a FRESH in-process mock (own key, own clock) and returns { actual, trace }.
import { createMockOP, createInProcessFetch, createTracer, PiFlowDriver, CibaDriver, callResource, MOCK_PASSWORD, MOCK_OTP } from 'pingone-piflow-core';

export const BASE = 'https://mock-op.example';
const CLIENT = 'lab-app';
const REDIRECT = 'https://app.lab.example/callback';

export function makeLab() {
  let t = 1_800_000_000_000;
  const clk = { now: () => t, advance: (s) => { t += s * 1000; } };
  const op = createMockOP({ now: clk.now });
  const fetchLike = createInProcessFetch(op, { baseUrl: BASE });
  const tracer = createTracer(fetchLike);
  return {
    clk, op, fetchLike, tracer,
    driver: () => new PiFlowDriver({ fetchLike, baseUrl: BASE, clientId: CLIENT, redirectUri: REDIRECT, tracer }),
    ciba: () => new CibaDriver({ fetchLike, baseUrl: BASE, clientId: CLIENT, tracer }),
  };
}

const ok = (r) => r.status === 200;
const wrong = 'not-the-password';

export const IMPLS = {
  async 'happy-path'({ l, cast }) {
    const r = await l.driver().run({ username: cast.plain, passwords: [MOCK_PASSWORD] });
    return { outcome: r.outcome, acr: r.claims?.acr, amr: r.claims?.amr.join(','), nonceMatches: r.nonceOk };
  },
  async 'wrong-password-then-success'({ l, cast }) {
    const d = l.driver();
    const r = await d.run({ username: cast.plain, passwords: [wrong, MOCK_PASSWORD] });
    return { outcome: r.outcome, attemptsUsedAfterFirstTry: d.trace[1].response.body.attempts?.used };
  },
  async lockout({ l, cast }) {
    const d = l.driver();
    await d.authorize();
    let last;
    for (let i = 0; i < 3; i++) last = await d.submit('password', { username: cast.plain, password: wrong });
    const right = await d.submit('password', { username: cast.plain, password: MOCK_PASSWORD });
    return { outcome: 'refused', error: last.json.error.code, rightPasswordAlsoRefused: right.json.error?.code === 'ACCOUNT_LOCKED' };
  },
  async 'stale-cookie-resume'({ l, cast }) {
    const d = l.driver();
    await d.authorize();
    const stale = { ...d.jar };
    await d.submit('password', { username: cast.plain, password: MOCK_PASSWORD });
    const fresh = { ...d.jar };
    d.jar = stale;
    const bad = await d.resume('Replaying the cookie from before the password step.');
    d.jar = fresh;
    const good = await d.resume('The current cookie.');
    return { outcome: ok(bad) ? 'signed_in' : 'refused', status: bad.status, error: bad.json.code, currentCookieStillWorks: ok(good) };
  },
  async 'expired-flow'({ l, cast }) {
    const d = l.driver();
    await d.authorize();
    l.clk.advance(l.op.config.flowTtlS + 1);
    const r = await d.submit('password', { username: cast.plain, password: MOCK_PASSWORD }, 'Just over five minutes later (injected clock).');
    return { outcome: ok(r) ? 'signed_in' : 'refused', error: r.json.code };
  },
  async 'replayed-code'({ l, cast }) {
    const d = l.driver();
    await d.authorize(); await d.submit('password', { username: cast.plain, password: MOCK_PASSWORD }); await d.resume();
    const first = await d.exchange();
    const again = await d.exchange({ note: 'The same code again.' });
    return { outcome: ok(again) ? 'signed_in' : 'refused', error: again.json.error, firstExchangeOk: ok(first) };
  },
  async 'wrong-verifier'({ l, cast }) {
    const d = l.driver();
    await d.authorize(); await d.submit('password', { username: cast.plain, password: MOCK_PASSWORD }); await d.resume();
    const bad = await d.exchange({ verifier: 'x'.repeat(43), note: 'A verifier that was never hashed into the challenge.' });
    const retry = await d.exchange({ note: 'Even the right verifier now fails: the code was burned.' });
    return { outcome: ok(bad) ? 'signed_in' : 'refused', error: bad.json.error, codeBurned: !ok(retry) };
  },
  async 'redirect-login-refused'({ l }) {
    const a = await l.driver().authorize({ response_mode: undefined });
    return { outcome: ok(a) ? 'signed_in' : 'refused', status: a.status, error: a.json.error, cookieIssued: a.setCookies.length > 0 };
  },
  async 'step-up-low-acr'({ l, cast }) {
    const first = await l.driver().run({ username: cast.plain, passwords: [MOCK_PASSWORD] });
    const denied = await callResource(l.tracer, BASE, first.tokens.access_token, { note: 'A password-only token (mock:single) calls the transfer endpoint.' });
    const acr = denied.challenge?.acr_values?.join(' ');
    const second = await l.driver().run({ username: cast.plain, passwords: [MOCK_PASSWORD], otp: MOCK_OTP, authorize: { acr_values: acr } });
    const granted = await callResource(l.tracer, BASE, second.tokens.access_token, { note: 'Retry with the stepped-up token.' });
    return { outcome: ok(granted) ? 'stepped_up' : 'refused', firstStatus: denied.status, challengeAcr: acr, secondStatus: granted.status, acr: second.claims.acr };
  },
  async 'max-age-stale'({ l, cast }) {
    const a = await l.driver().run({ username: cast.strong, passwords: [MOCK_PASSWORD], otp: MOCK_OTP });
    const fresh = await callResource(l.tracer, BASE, a.tokens.access_token, { note: 'Just signed in: fine.' });
    l.clk.advance(l.op.config.rsMaxAgeS + 1);
    const stale = await callResource(l.tracer, BASE, a.tokens.access_token, { note: 'Same token, over five minutes later (injected clock).' });
    const b = await l.driver().run({ username: cast.strong, passwords: [MOCK_PASSWORD], otp: MOCK_OTP, authorize: { max_age: String(stale.challenge?.max_age) } });
    const final = await callResource(l.tracer, BASE, b.tokens.access_token, { note: 'Fresh authentication.' });
    return { outcome: ok(final) ? 'stepped_up' : 'refused', firstStatus: fresh.status, staleStatus: stale.status, challengeMaxAge: stale.challenge?.max_age, finalStatus: final.status };
  },
  async 'ciba-approve'({ l, cast }) {
    const c = l.ciba();
    await c.start({ loginHint: cast.plain, bindingMessage: 'AB12' });
    const p1 = await c.poll();
    l.clk.advance(6);
    await c.phone('approve');
    const t = await c.poll();
    return { outcome: ok(t) ? 'signed_in' : 'refused', firstPoll: p1.json.error };
  },
  async 'ciba-deny'({ l, cast }) {
    const c = l.ciba();
    await c.start({ loginHint: cast.plain, bindingMessage: 'AB12' });
    await c.phone('deny');
    const t = await c.poll();
    return { outcome: ok(t) ? 'signed_in' : 'refused', error: t.json.error };
  },
  async 'ciba-expire'({ l, cast }) {
    const c = l.ciba();
    await c.start({ loginHint: cast.plain, bindingMessage: 'AB12', requestedExpiry: 30 });
    l.clk.advance(31);
    const t = await c.poll('31 seconds later (injected clock).');
    return { outcome: ok(t) ? 'signed_in' : 'refused', error: t.json.error };
  },
  async 'ciba-slow-down'({ l, cast }) {
    const c = l.ciba();
    await c.start({ loginHint: cast.plain, bindingMessage: 'AB12' });
    const p1 = await c.poll();
    const p2 = await c.poll('Immediately again.');
    return { outcome: ok(p2) ? 'signed_in' : 'refused', firstPoll: p1.json.error, error: p2.json.error, intervalNow: Number(/(\d+)s/.exec(p2.json.error_description)?.[1]) };
  },
  async 'ciba-binding-too-long'({ l, cast }) {
    const r = await l.ciba().start({ loginHint: cast.plain, bindingMessage: 'THIS-IS-TOO-LONG' });
    return { outcome: ok(r) ? 'signed_in' : 'refused', status: r.status, error: r.json.error };
  },
  async 'mfa-login'({ l, cast }) {
    const d = l.driver();
    await d.authorize();
    const pw = await d.submit('password', { username: cast.multi, password: MOCK_PASSWORD });
    const pick = pw.json._embedded.devices[1].id;
    await d.submit('device', { device: { id: pick } });
    await d.submit('otp', { otp: MOCK_OTP });
    await d.resume();
    const t = await d.exchange();
    const claims = JSON.parse(Buffer.from(t.json.id_token.split('.')[1], 'base64url'));
    return { outcome: ok(t) ? 'signed_in' : 'refused', acr: claims.acr, amr: claims.amr.join(','), devicePicked: pw.json.status === 'DEVICE_SELECTION_REQUIRED' };
  },
};
