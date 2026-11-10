// Builds content-pack.json for the Learning Hub from the scenario data, so the pack cannot drift from the scenarios.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
// Everything the mock invents (acr names, the MFA status order, the cookie rotation, the lockout rule, the 8 character binding limit, the authorizeResponse resume body) is labelled
// "mock" or UNVERIFIED in the definitions below, the same way the UI labels it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { SCENARIOS as scenarios, VERTICALS, renderScenario } from '../server/src/stories.js';
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function buildPack() {
  return {
    schema: 'demo-content-pack/1',
    id: 'pingone-signin-lab',
    title: 'PingOne Sign-in LAB (mock)',
    version,
    demo: {
      id: 'pingone-signin-lab', name: 'PingOne Sign-in LAB', catalog: 'A11', // pi.flow native sign-in kit; A5 (Step-up auth) and A4 (CIBA lab) are real catalog rows with this lab as their home, listed in tags
      baseUrl: 'http://localhost:6171', doctor: '/api/health', tags: ['pi.flow', 'step-up', 'rfc-9470', 'ciba', 'mfa', 'passkey', 'webauthn', 'fido2', 'mock', 'catalog-A4', 'catalog-A5'],
    },
    glossary: [
      { id: 'pi-flow', term: 'pi.flow (response_mode=pi.flow)', definition: 'An embedded sign-in: the authorize request is answered with JSON describing a flow and its status, not with a redirect to a hosted login page. The client (usually a BFF) then drives the flow one step at a time. This lab signs in this way only, and teaches how such a sign-in behaves (failures, lockout, replay, MFA, step-up, CIBA) as a mock-only simulation. The shared shapes follow a real PingOne run recorded in pingone-LAB (http://127.0.0.1:5500); the rest is modelled on the public PingOne sample apps and is UNVERIFIED against a real tenant.', aliases: ['embedded login', 'pi.flow'] },
      { id: 'redirect-login', term: 'Redirect-based login', definition: 'The classic authorization-code login: the browser is redirected to a hosted sign-in page and back. This lab refuses it on purpose (scenario S08): an authorize request without response_mode=pi.flow gets an error and no flow or cookie. Contrast with pi.flow, where the user never leaves the application.' },
      { id: 'flow-status', term: 'Flow status', definition: 'Where a pi.flow flow is: USERNAME_PASSWORD_REQUIRED, then DEVICE_SELECTION_REQUIRED and OTP_REQUIRED when MFA applies, then COMPLETED. The code is not in the COMPLETED answer: the client calls GET /as/resume?flowId= and reads authorizeResponse. USERNAME_PASSWORD_REQUIRED, COMPLETED and the resume call were seen on a real PingOne run (pingone-LAB); the MFA statuses and their order are this lab\'s invention, UNVERIFIED. A real PingOne has more statuses (SIGN_ON_REQUIRED on an identifier-first policy, policy screens, external IdP steps), which this lab does not drive.' },
      { id: 'session-token-cookie', term: 'Session-token cookie (ST)', definition: 'A cookie that binds a flow to one client. In this mock it is replaced on every step, and a flow call or resume with an old or missing cookie is 401 INVALID_SESSION_TOKEN. The cookie name ST was seen on a real PingOne run; rotating it on every step, and the 401 for an old one, are this lab\'s invention, UNVERIFIED. The page never sees the real value (HttpOnly); it shows the server\'s shortened preview.', aliases: ['ST cookie', 'cookie rotation'] },
      { id: 'pkce', term: 'PKCE (S256)', definition: 'RFC 7636. The client sends a hash of a secret verifier with the authorize request and the verifier with the token request, so a stolen code is useless. This lab requires S256, state and nonce, and burns a code on its first use.', aliases: ['code_challenge', 'code_verifier'] },
      { id: 'acr', term: 'acr and amr', definition: 'acr says how strongly the user authenticated; amr lists the methods used (pwd, otp, mfa, ciba). The acr strings in this lab, mock:single and mock:multi, are invented. Which acr strings a real PingOne issues is UNVERIFIED.', aliases: ['authentication context class reference'] },
      { id: 'auth-time-max-age', term: 'auth_time and max_age', definition: 'auth_time is when the user last authenticated. A resource server can demand a recent one (max_age). In this mock every authorize is a fresh login, so max_age is satisfied by the new login; real SSO-session behaviour is not modelled.' },
      { id: 'step-up', term: 'Step-up authentication (RFC 9470)', definition: 'A resource server refuses a token that proves too little with 401 and WWW-Authenticate: Bearer error="insufficient_user_authentication", acr_values and/or max_age. The client re-authorizes with those values and retries. The RFC is the standard; whether PingOne supports it this way is UNVERIFIED.', aliases: ['RFC 9470', 'insufficient_user_authentication'] },
      { id: 'ciba', term: 'CIBA (backchannel authentication)', definition: 'The client asks the server to authenticate a user on their own device (POST /bc-authorize), then polls the token endpoint. States seen while polling: authorization_pending, slow_down (poll slower), access_denied (the user said no), expired_token (too late). In the lab a MOCK PHONE approves or denies.', aliases: ['client initiated backchannel authentication', 'backchannel'] },
      { id: 'binding-message', term: 'binding_message', definition: 'A short text shown on both the client and the user\'s device so the user can tell which request they are approving. This mock limits it to 8 characters; that limit is the mock\'s own value and the real limit is UNVERIFIED.' },
      { id: 'traceparent', term: 'traceparent (W3C Trace Context)', definition: 'A request header, 00-<32 hex trace id>-<16 hex span id>-01, that ties the hops of one run together. Every request this lab makes carries one (one trace id per run, a new span id per hop) and the mock answers with the same trace id and a new span id, so a trace can be followed across the page, the BFF and the mock.', aliases: ['trace context'] },
      { id: 'passkey', term: 'Passkey (WebAuthn / FIDO2)', definition: 'A key pair made by an authenticator (a phone, a laptop, a security key) for one relying party (RP). The private key never leaves the authenticator; the RP stores the public key. Registration (navigator.credentials.create) sends the public key inside an attestationObject; sign-in (navigator.credentials.get) sends a signature over the authenticatorData and a hash of clientDataJSON. In this lab the RP is a mock on the page\'s own origin, and where the browser cannot make a real passkey a clearly labelled simulated authenticator in the page stands in.', aliases: ['WebAuthn', 'FIDO2', 'passkey ceremony'] },
      { id: 'webauthn-checks', term: 'What a WebAuthn RP checks', definition: 'clientDataJSON.type (webauthn.create or webauthn.get), the challenge (one the RP issued, single use, not expired), the origin (the RP origin), authenticatorData.rpIdHash = SHA-256(RP ID), the User Present flag (UP; User Verified, UV, when required), at registration the public key algorithm, and at sign-in the signature against the stored public key and a signCount that went up (if either side counts). The flags BE and BS say whether the passkey may be, and is, synced. Attestation is not checked here (the mock RP asks for attestation none).', aliases: ['signCount', 'rpIdHash', 'UP UV BE BS'] },
      { id: 'rp-id', term: 'RP ID (rp.id)', definition: 'The domain a passkey is bound to. It must be the page\'s domain or a parent of it; an IP address is never valid, so the lab\'s browser passkeys run on http://localhost and not on 127.0.0.1. A passkey made for another RP ID is never offered by the browser. For a real PingOne passkey sign-in the FIDO policy\'s Relying Party ID must match the sign-in page\'s domain.' },
      { id: 'mock-phone', term: 'Mock phone', definition: 'A stand-in in the UI for the user\'s device in CIBA: it shows the notification and has Approve and Deny buttons that call the mock\'s /phone endpoints. It is not a PingOne feature.' },
    ],
    sources: [
      { id: 'rfc7636', title: 'RFC 7636: Proof Key for Code Exchange by OAuth Public Clients', url: 'https://www.rfc-editor.org/rfc/rfc7636', kind: 'standard', use: 'S256 code_challenge and code_verifier required by the mock', status: 'not-read', checked: '2026-10-21' },
      { id: 'rfc9470', title: 'RFC 9470: OAuth 2.0 Step Up Authentication Challenge Protocol', url: 'https://www.rfc-editor.org/rfc/rfc9470', kind: 'standard', use: 'the insufficient_user_authentication challenge with acr_values and max_age', status: 'not-read', checked: '2026-10-21' },
      { id: 'ciba-core', title: 'OpenID Connect Client-Initiated Backchannel Authentication Core 1.0', url: 'https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html', kind: 'standard', use: 'bc-authorize, polling errors (authorization_pending, slow_down, access_denied, expired_token), binding_message', status: 'not-read', checked: '2026-10-21' },
      { id: 'webauthn-l3', title: 'Web Authentication: An API for accessing Public Key Credentials, Level 3 (W3C)', url: 'https://www.w3.org/TR/webauthn-3/', kind: 'standard', use: 'the registration and authentication verification steps the mock RP shows (7.1 and 7.2), flags, signCount', status: 'not-read', checked: '2026-11-09' },
    ],
    cards: [
      { id: 'try-signin', label: 'Sign in with pi.flow', description: 'A real embedded form, one request at a time, with the trace and the decoded tokens.', group: 'try-it', action: { type: 'route', href: '/#/signin' }, terms: ['pi-flow', 'flow-status', 'session-token-cookie'], story: 'S01' },
      { id: 'try-stepup', label: 'Step up when the resource says so', description: 'Call the resource with a low-acr token, read the 401 challenge, re-authorize, retry.', group: 'try-it', action: { type: 'route', href: '/#/stepup' }, terms: ['step-up', 'acr'], story: 'S09' },
      { id: 'try-ciba', label: 'CIBA with a mock phone', description: 'Start a backchannel request, approve or deny on the mock phone, watch the polling states.', group: 'try-it', action: { type: 'route', href: '/#/ciba' }, terms: ['ciba', 'binding-message', 'mock-phone'], story: 'S11' },
      { id: 'try-passkey', label: 'Register and sign in with a passkey', description: 'A WebAuthn ceremony against the lab\'s own mock RP: options, clientDataJSON, flags, signCount and every server check, then a refused replay. PingOne\'s FIDO2 step (Real) needs tenant setup.', group: 'try-it', action: { type: 'route', href: '/#/passkey' }, terms: ['passkey', 'webauthn-checks', 'rp-id'] },
      { id: 'try-scenarios', label: 'Run all scenarios', description: 'Sixteen scripted stories, each compared with what the data file says should happen.', group: 'try-it', action: { type: 'route', href: '/#/scenarios' }, terms: ['pkce'] },
      { id: 'try-diagram', label: 'Watch the flows on a diagram', description: 'Browser, BFF, mock PingOne, resource server and mock phone: Simulate, drag, change speed.', group: 'try-it', action: { type: 'route', href: '/#/diagram' }, terms: ['pi-flow'] },
      { id: 'concept-piflow-vs-redirect', label: 'pi.flow versus redirect login', description: 'Why the lab refuses a redirect-based login, and what an embedded flow changes.', group: 'concept', action: { type: 'route', href: '/#/scenarios' }, terms: ['pi-flow', 'redirect-login'], story: 'S08' },
      { id: 'concept-flow-statuses', label: 'Flow statuses', description: 'From USERNAME_PASSWORD_REQUIRED to COMPLETED (then GET /as/resume), with MFA in between. The MFA order is a lab invention, UNVERIFIED.', group: 'concept', action: { type: 'route', href: '/#/signin' }, terms: ['flow-status'], story: 'S16' },
      { id: 'concept-cookie-rotation', label: 'Cookie rotation', description: 'Lab invention: the session-token cookie changes at every step; an old one cannot resume.', group: 'concept', action: { type: 'route', href: '/#/scenarios' }, terms: ['session-token-cookie'], story: 'S04' },
      { id: 'concept-stepup', label: 'Step-up, RFC 9470', description: 'Challenge, re-authorize with acr_values and max_age, retry.', group: 'concept', action: { type: 'route', href: '/#/stepup' }, terms: ['step-up', 'acr', 'auth-time-max-age'], story: 'S10' },
      { id: 'concept-ciba-states', label: 'CIBA states', description: 'pending, slow_down, denied, expired and approved.', group: 'concept', action: { type: 'route', href: '/#/ciba' }, terms: ['ciba'], story: 'S14' },
      { id: 'ref-talk-track', label: 'Talk track and presenter mode', description: 'The script, and presenter mode (P, Esc to leave): large text, no raw panes and arrow keys that step the diagram.', group: 'reference', action: { type: 'route', href: '/#/talk' } },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    diagrams: [
      { id: 'pingone-signin-login', label: 'Sign in (pi.flow): browser, BFF, mock PingOne', href: '/#/diagram', mode: 'login' },
      { id: 'pingone-signin-stepup', label: 'Step-up (RFC 9470): resource server and re-authorization', href: '/#/diagram', mode: 'stepup' },
      { id: 'pingone-signin-ciba', label: 'CIBA: backchannel, mock phone and polling', href: '/#/diagram', mode: 'ciba' },
    ],
    // Rendered with the first vertical pack's names and words, so the hub never shows a {{token}}.
    stories: scenarios.map((s) => { const r = renderScenario(s, VERTICALS[0]); return { id: s.id, title: r.title, say: r.takeaway }; }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
  console.log('wrote content-pack.json');
}
