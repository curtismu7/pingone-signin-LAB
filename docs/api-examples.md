# API examples: every request in a pi.flow sign-in

These are requests and responses captured from a run of this lab on 2026-10-26, with the host name rewritten to the local one (`http://127.0.0.1:6171`) and the HTTP version shown as 1.1. The local copy answers the same way. Every value is a mock: the users, passwords, acr names, token signing key and issuer are fictional. The status `COMPLETED`, the `GET /as/resume` call and `INVALID_CREDENTIALS` follow the shapes pingone-LAB saw on a real PingOne run (2026-10-30); the acr names, the cookie rotation, the lockout, the passcode and the CIBA limits are this lab's inventions and UNVERIFIED against a real PingOne tenant. For real shapes and live use, see `pingone-LAB` (http://127.0.0.1:5500).

**The rule that matters:** sign-in is pi.flow only. The authorize request must carry `response_mode=pi.flow`. Without it the lab refuses the request with `400 invalid_request` and sets no cookie, so there is no redirect login path.

Set these once:

```sh
H=http://127.0.0.1:6171
J=/tmp/lab-jar.txt                                       # one cookie jar for the whole flow
rm -f "$J"
# PKCE pair (S256): verifier is 43-128 characters; challenge = base64url(sha256(verifier))
V=<code-verifier>
C=<code-challenge>
```

## Why pi.flow, and how it differs from a redirect login

A standard OpenID Connect sign-in sends the user's browser to the provider's login page, and the provider sends them back with a code. pi.flow does the same job with the login steps in your own app: `GET /authorize` answers with JSON, the app shows the form, and each step is a request to the flow.

| Step | Redirect login (no `response_mode`) | pi.flow (`response_mode=pi.flow`) |
|---|---|---|
| `GET /authorize` answers with | a 302 to the provider's login page | JSON: a flow id and a status such as `USERNAME_PASSWORD_REQUIRED` |
| Who draws the login screen | the provider, on its own page | this app, from the status the flow returns |
| Where the password goes | typed on the provider's page; this app never sees it | POSTed by this app to `/flows/{id}`; this app handles it |
| How the user returns | a redirect back to the `redirect_uri` with a code | the user never leaves; `GET /as/resume` returns the code |

Why use pi.flow: the login stays in your own UI, so you can brand it and explain each step, with no browser hop. The cost: your app now handles the credentials, so it has to protect them. This lab is pi.flow only. An authorize request without `response_mode=pi.flow` is refused with `400`, and there is no redirect login path. PingOne's behaviour behind these steps is UNVERIFIED here.

## 1. Open the flow: `GET /mock/authorize` with `response_mode=pi.flow`

```http
GET /mock/authorize?client_id=lab-app&redirect_uri=https%3A%2F%2Fapp.lab.example%2Fcallback&response_type=code&scope=openid&response_mode=pi.flow&code_challenge=<code-challenge>&code_challenge_method=S256&state=st1&nonce=n1&login_hint=mark HTTP/1.1
```

```sh
curl -s -b "$J" -c "$J" "$H/mock/authorize?client_id=lab-app&redirect_uri=https%3A%2F%2Fapp.lab.example%2Fcallback&response_type=code&scope=openid&response_mode=pi.flow&code_challenge=$C&code_challenge_method=S256&state=st1&nonce=n1&login_hint=mark"
```

Response, `200`:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
cache-control: no-store
set-cookie: ST=<st-cookie>; Path=/; HttpOnly; SameSite=Lax

{"id":"<flow-id>","status":"USERNAME_PASSWORD_REQUIRED","expiresAt":"2026-10-26T11:49:38.058Z","_links":{"self":{"href":"http://127.0.0.1:6171/mock/flows/<flow-id>"},"usernamePassword.check":{"href":"http://127.0.0.1:6171/mock/flows/<flow-id>"}}}
```

The `_links` are built from the Host the request arrived with (UNVERIFIED against a real PingOne). The `ST` cookie binds the flow to this browser.

Without `response_mode=pi.flow`:

```sh
curl -si "$H/mock/authorize?client_id=lab-app&redirect_uri=https%3A%2F%2Fapp.lab.example%2Fcallback&response_type=code&scope=openid&state=st1"
# HTTP/1.1 400  {"error":"invalid_request", ...}   no flow, no cookie
```

## 2. Password step: `POST /mock/flows/{id}` with the pi.flow content type

```sh
curl -s -b "$J" -c "$J" -X POST "$H/mock/flows/<flow-id>" \
  -H 'content-type: application/vnd.pingidentity.usernamePassword.check+json' \
  -d '{"username":"mark","password":"mock-password"}'
```

Response, `200`:

```json
{"id":"<flow-id>","status":"COMPLETED","expiresAt":"2026-10-26T11:49:38.058Z","_links":{"self":{"href":"http://127.0.0.1:6171/mock/flows/<flow-id>"},"resume":{"href":"http://127.0.0.1:6171/mock/as/resume?flowId=<flow-id>"}},"resumeUrl":"http://127.0.0.1:6171/mock/as/resume?flowId=<flow-id>"}
```

`COMPLETED` means the sign-in is done; it does not carry the code (step 3 fetches it). A wrong password is `400`, the flow keeps waiting, and the body names the reason in `details[].code`:

```json
{"id":"<flow-id>","status":"USERNAME_PASSWORD_REQUIRED","expiresAt":"2026-10-26T11:49:38.058Z","_links":{"self":{"href":"..."},"usernamePassword.check":{"href":"..."}},"code":"INVALID_DATA","message":"the username or password is incorrect","details":[{"code":"INVALID_CREDENTIALS","message":"the username or password is incorrect"}],"attempts":{"used":1,"max":3,"remaining":2}}
```

`details[].code` follows pingone-LAB's real run; the top-level `INVALID_DATA` is pingone-LAB's mock and the `attempts` counter is a lab invention (UNVERIFIED).

Users who need more: `dana` (1 device) and `priya` (2 devices) get `DEVICE_SELECTION_REQUIRED` and then `OTP_REQUIRED`. The one-time passcode is `424242`. A step-up request (acr `mock:multi`) also asks for the device and passcode, so `mark` does too when the authorize request asks for it. Each step rotates the `ST` cookie, so always keep the jar.

## 3. Resume: `GET /mock/as/resume` with the current cookie

```sh
curl -s -b "$J" -c "$J" "$H/mock/as/resume?flowId=<flow-id>"
```

Response, `200`:

```json
{"authorizeResponse":{"code":"<authorization-code>","state":"st1"}}
```

The `authorizeResponse` body is pingone-LAB's mock shape. UNVERIFIED: a real PingOne may answer with a redirect to the `redirect_uri` instead.

A stale cookie (from before step 2) is refused with `401 INVALID_SESSION_TOKEN` (a lab rule, UNVERIFIED). The code is single use. The mock burns it on its first exchange, right or wrong.

## 4. Token: `POST /mock/token` with the code and the PKCE verifier

```sh
curl -s -b "$J" -X POST "$H/mock/token" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode grant_type=authorization_code \
  --data-urlencode "code=<authorization-code>" \
  --data-urlencode client_id=lab-app \
  --data-urlencode redirect_uri=https://app.lab.example/callback \
  --data-urlencode "code_verifier=$V"
```

Response, `200`:

```json
{"token_type":"Bearer","access_token":"<access-token>","id_token":"<access-token>","expires_in":900,"scope":"openid"}
```

Decoded `id_token` claims (the mock signs HS256 with a throwaway key):

```json
{"iss":"https://mock-op.example","sub":"usr-mark","auth_time":<unix-time>,"acr":"mock:single","amr":["pwd"],"mock":true,"aud":"lab-app","exp":<unix-time>,"name":"Mark Ellison","nonce":"n1"}
```

## 5. Resource server: call with the access token

```sh
AT='<access-token>'   # the access_token from step 4
curl -s -b "$J" "$H/mock/rs/balance" -H "authorization: Bearer $AT"
# 200 {"balance":1250,"currency":"USD","acr":"mock:single","mock":true}
```

A transfer needs `acr` `mock:multi`. With the single-factor token it is refused:

```sh
curl -si -b "$J" -X POST "$H/mock/rs/transfer" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{"to":"acct-2","amount":100}'
```

```http
HTTP/1.1 401
www-authenticate: Bearer error="insufficient_user_authentication", error_description="acr mock:single is below mock:multi", acr_values="mock:multi"

{"error":"insufficient_user_authentication","error_description":"acr mock:single is below mock:multi"}
```

Step-up: open a new flow with `acr_values=mock:multi` (add it to the authorize request in step 1), complete steps 2 to 4, then retry the transfer with the new token.

## 6. CIBA: backchannel request, then poll

The binding message is at most 8 characters (a mock limit, UNVERIFIED).

```sh
curl -s -b "$J" -c "$J" -X POST "$H/mock/bc-authorize" \
  --data-urlencode login_hint=mark --data-urlencode scope=openid \
  --data-urlencode binding_message=xfer800 --data-urlencode client_id=lab-app
```

```json
{"auth_req_id":"<auth-req-id>","expires_in":120,"interval":5}
```

Poll the token endpoint with the CIBA grant (send no faster than `interval`):

```sh
curl -s -b "$J" -X POST "$H/mock/token" \
  --data-urlencode grant_type=urn:openid:params:grant-type:ciba \
  --data-urlencode auth_req_id=<auth-req-id> --data-urlencode client_id=lab-app
```

```json
{"error":"authorization_pending","error_description":"the user has not responded yet"}
```

Other answers: `slow_down` (poll too fast; the interval goes up by 5 s), `access_denied` (the mock phone denied it), `expired_token` (after `expires_in`). Once approved, the poll returns the same token shape as step 4. Approve or deny on the mock phone: `POST /mock/phone/approve` or `/mock/phone/deny` with the same `auth_req_id` (from the UI's CIBA tab in the lab).

## Errors you will see

| Call | Status | Body |
|---|---|---|
| authorize without `response_mode=pi.flow` | 400 | `{"error":"invalid_request", ...}` |
| flow id that does not exist | 404 | `{"error":"not_found"}` |
| resume with a stale cookie | 401 | `INVALID_SESSION_TOKEN` (lab rule, UNVERIFIED) |
| wrong password | 400 | `details[].code` = `INVALID_CREDENTIALS` |
| resume before the flow is `COMPLETED` | 400 | `NOT_READY` |
| token with a used or unknown code | 400 | `{"error":"invalid_grant","error_description":"unknown authorization code"}` |
| binding message over 8 characters | 400 | `{"error":"invalid_binding_message", ...}` |
