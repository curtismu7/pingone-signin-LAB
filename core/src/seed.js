// Seeded FICTIONAL data. Passwords, OTPs and client ids mean nothing outside this process. Hosts are reserved (.example).
export const MOCK_PASSWORD = 'mock-password';
export const MOCK_OTP = '424242';
const dev = (id, type, label) => Object.freeze({ id, type, label });

// role: plain = password only (one device enrolled, MFA not demanded); strong = MFA always, one device; multi = MFA always, two devices.
export const USERS = Object.freeze({
  mark:  { sub: 'usr-mark',  name: 'Mark Ellison', email: 'mark@travel.example',  password: MOCK_PASSWORD, mfa: false, devices: [dev('dev-mark-sms', 'SMS', 'SMS ending 0101')] },
  dana:  { sub: 'usr-dana',  name: 'Dana Okafor',  email: 'dana@travel.example',  password: MOCK_PASSWORD, mfa: true,  devices: [dev('dev-dana-sms', 'SMS', 'SMS ending 0102')] },
  priya: { sub: 'usr-priya', name: 'Priya Nair',   email: 'priya@travel.example', password: MOCK_PASSWORD, mfa: true,  devices: [dev('dev-priya-sms', 'SMS', 'SMS ending 0103'), dev('dev-priya-mail', 'EMAIL', 'email p***@travel.example')] },
  alice: { sub: 'usr-alice', name: 'Alice Moreau', email: 'alice@bank.example',   password: MOCK_PASSWORD, mfa: false, devices: [dev('dev-alice-sms', 'SMS', 'SMS ending 0201')] },
  ravi:  { sub: 'usr-ravi',  name: 'Ravi Menon',   email: 'ravi@bank.example',    password: MOCK_PASSWORD, mfa: true,  devices: [dev('dev-ravi-sms', 'SMS', 'SMS ending 0202')] },
  lena:  { sub: 'usr-lena',  name: 'Lena Fischer', email: 'lena@clinic.example',  password: MOCK_PASSWORD, mfa: false, devices: [dev('dev-lena-sms', 'SMS', 'SMS ending 0301')] },
  omar:  { sub: 'usr-omar',  name: 'Omar Haddad',  email: 'omar@clinic.example',  password: MOCK_PASSWORD, mfa: true,  devices: [dev('dev-omar-sms', 'SMS', 'SMS ending 0302')] },
  sana:  { sub: 'usr-sana',  name: 'Sana Iyer',    email: 'sana@clinic.example',  password: MOCK_PASSWORD, mfa: true,  devices: [dev('dev-sana-sms', 'SMS', 'SMS ending 0303'), dev('dev-sana-mail', 'EMAIL', 'email s***@clinic.example')] },
  noah:  { sub: 'usr-noah',  name: 'Noah Brandt',  email: 'noah@bank.example',    password: MOCK_PASSWORD, mfa: true,  devices: [dev('dev-noah-sms', 'SMS', 'SMS ending 0203'), dev('dev-noah-mail', 'EMAIL', 'email n***@bank.example')] },
});

export const CLIENTS = Object.freeze({
  'lab-app':   { name: 'Lab app (mock public client)', redirectUris: ['https://app.lab.example/callback'] },
  'lab-other': { name: 'Another lab app (mock)',       redirectUris: ['https://other.lab.example/callback'] },
});

export const DEFAULTS = Object.freeze({
  baseUrl: 'https://mock-op.example',
  issuer: 'https://mock-op.example',
  rsAudience: 'https://rs.mock.example/transfer',
  flowTtlS: 300, codeTtlS: 60, accessTtlS: 900, idTtlS: 900,
  maxAttempts: 3, lockoutS: 300, otpAttempts: 3, maxLockEntries: 1000,
  cibaExpiryS: 120, cibaMaxExpiryS: 600, cibaIntervalS: 5, bindingMax: 8,
  rsRequireAcr: 'mock:multi', rsMaxAgeS: 300,
});
