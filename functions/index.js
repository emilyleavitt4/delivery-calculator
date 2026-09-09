// 17hats structured-invoice import adapter — the one and only backend endpoint this app has.
// Exists solely because a browser can't safely fetch a third-party domain directly (undocumented
// CORS behavior shouldn't be relied on, and doing the fetch here keeps 17hats' actual response
// shape from ever reaching the client at all — see normalize.js for what's extracted vs.
// discarded). This is a real Cloud Function and requires the Firebase project to be on the Blaze
// (pay-as-you-go) plan to deploy — see the deployment notes below. NOT deployed as of this
// commit; writing this file doesn't change the live app at all until `firebase deploy --only
// functions` is actually run.
//
// Deploy steps (when ready — do not run without checking first, per the project's own billing
// gate):
//   1. Enable Blaze billing on the `balloon-toolbox` Firebase project.
//   2. `npm install` inside functions/ (installs firebase-functions).
//   3. `firebase login` (one-time, if not already authenticated with the Firebase CLI).
//   4. `firebase deploy --only functions` from the project root (where firebase.json lives).

const { onCall } = require('firebase-functions/v2/https');
const { normalizeInvoice } = require('./normalize');

// Deliberately narrow and independent of whatever the client already validated — a subdomain and
// a token, never a raw URL. The fetch target below is always built from these two validated
// pieces via a fixed template, so there is no code path where caller-supplied input becomes the
// literal fetch URL. No business is hardcoded here — any 17hats subdomain shape is accepted,
// matching Balloon Code's intent to support more than one balloon business.
const SUBDOMAIN_RE = /^[a-z0-9-]{1,63}$/;
const TOKEN_RE = /^[A-Za-z0-9]{6,20}$/;
const FETCH_TIMEOUT_MS = 10000;

exports.fetch17hatsInvoice = onCall(async (request) => {
  // Require a real, signed-in caller — this app's existing sign-in flow is the identity boundary
  // reused here, the same way every other action in this app is already gated behind being
  // signed in before Firestore Security Rules apply their own, finer-grained checks. This
  // function makes no writes and touches no business data, so it doesn't need anything finer
  // than "signed in" — flagged in the implementation report as a real, deliberate scope choice.
  if (!request.auth) {
    return { ok: false, reason: 'unauthenticated' };
  }

  const subdomain = String((request.data && request.data.subdomain) || '').toLowerCase();
  const token = String((request.data && request.data.token) || '');
  if (!SUBDOMAIN_RE.test(subdomain) || !TOKEN_RE.test(token)) {
    return { ok: false, reason: 'invalid_url' };
  }

  const url = `https://${subdomain}.17hats.com/perl/client_invoice/${token}`;
  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? 'timeout' : 'not_found' };
  }

  if (!response.ok) {
    return { ok: false, reason: 'not_found' };
  }

  let raw;
  try {
    raw = await response.json();
  } catch (err) {
    return { ok: false, reason: 'unexpected_format' };
  }

  // A real 17hats invoice response always has a products array and its own matching public_id —
  // anything else (an HTML error page, a redirected login page, a shape 17hats changes later)
  // fails cleanly here rather than being guessed at downstream.
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.products)) {
    return { ok: false, reason: 'unexpected_format' };
  }
  if (raw.public_id && raw.public_id !== token) {
    return { ok: false, reason: 'unexpected_format' };
  }

  try {
    const normalized = normalizeInvoice(raw);
    return { ok: true, ...normalized };
  } catch (err) {
    console.error('17hats normalization failed:', err);
    return { ok: false, reason: 'unexpected_format' };
  }
});
