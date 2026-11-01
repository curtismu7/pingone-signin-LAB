// PKCE S256 with WebCrypto (the page is a secure context on localhost / 127.0.0.1). 32 random bytes -> a 43 character verifier.
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function newPkce() {
  const verifier = rand(32);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge: b64url(digest), state: rand(9), nonce: rand(9) };
}
