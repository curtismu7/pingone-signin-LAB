import { createMockOP, createInProcessFetch, PiFlowDriver, CibaDriver, MOCK_PASSWORD, MOCK_OTP } from '../src/index.js';

export const BASE = 'https://mock-op.example';
export const CLIENT = 'lab-app';
export const REDIRECT = 'https://app.lab.example/callback';
export { MOCK_PASSWORD, MOCK_OTP };

export function clock(start = 1_800_000_000_000) {
  let t = start;
  return { now: () => t, advance: (s) => { t += s * 1000; } };
}

export function lab({ config, users } = {}) {
  const clk = clock();
  const op = createMockOP({ now: clk.now, config, ...(users ? { users } : {}) });
  const fetchLike = createInProcessFetch(op, { baseUrl: BASE });
  const driver = () => new PiFlowDriver({ fetchLike, baseUrl: BASE, clientId: CLIENT, redirectUri: REDIRECT });
  const ciba = () => new CibaDriver({ fetchLike, baseUrl: BASE, clientId: CLIENT });
  return { clk, op, fetchLike, driver, ciba };
}
