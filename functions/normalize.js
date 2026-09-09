// Pure normalization logic for a 17hats client_invoice JSON response — deliberately separate
// from index.js (the actual network/auth-handling callable) so it can be unit-tested directly
// with plain Node against a real sample response, with no Firebase SDK involved at all.
//
// Produces the exact same downstream contract the PDF import already produces —
// { clientName, rawItems: [{ name, qty, unitPrice, totalPrice, details }] } — plus three small,
// additive extras a structured source can supply that a PDF never could: eventTitle (the
// invoice's own job/event title, distinct from the client's name), customFields (this business's
// own 17hats custom job fields, e.g. "Themes & Colors"), and invoiceMeta (a few facts about the
// invoice itself — number/total/due date — kept deliberately separate from customFields, since
// those are properties of the invoice, not business-defined job fields).
//
// Everything not explicitly extracted here is discarded, not "kept just in case" — the business's
// own billing address, 17hats' internal analytics/calendar-sync/activity-log objects, tax-setting
// internals, and client contact PII (email/phone) all exist in the raw payload but are
// deliberately never read or returned from this function. The raw response itself is never
// returned or stored anywhere.

// Splits an HTML "description_tokenized" block into the same flat { Key: Value } shape the PDF
// pipeline already produces from plain-text "Key: Value" lines (see index.html's PS_KV_LINE_RE) —
// same one-pair-per-line model, just paragraph-delimited instead of newline-delimited. This is
// what lets a genuinely unrecognized field (this real sample already has two: "Size", "Style")
// survive into that line's own `details` without any new parsing concept, and what lets an
// already-recognized field (Colors, Location) keep flowing through the existing Mapping Layer
// completely unchanged.
function parseTokenizedDetails(html) {
  const details = {};
  if (!html) return details;
  html.split(/<\/p>/i).forEach(chunk => {
    const text = chunk.replace(/<[^>]+>/g, '').trim();
    if (!text) return;
    const idx = text.indexOf(':');
    if (idx === -1) return;
    const key = text.slice(0, idx).trim();
    const value = text.slice(idx + 1).trim();
    if (key && value) details[key] = value;
  });
  return details;
}

function normalizeInvoice(raw) {
  const clientName = (raw.client && raw.client.name) || '';
  const eventTitle = (raw.job && raw.job.name) || '';

  const rawItems = (raw.products || [])
    .filter(p => !p.deleted_yn)
    .map(p => {
      const name = p.display_name_tokenized || p.display_name || p.name || '';
      const qty = Number(p.quantity) || 1;
      const unitPrice = parseFloat(p.amount) || 0;
      const totalPrice = unitPrice * qty;
      const details = parseTokenizedDetails(p.description_tokenized || p.description || '');
      if (Array.isArray(p.attachments) && p.attachments.length) {
        const filenames = p.attachments
          .map(a => a.asset && a.asset.filename)
          .filter(Boolean);
        if (filenames.length) details['Attachments'] = filenames.join(', ');
      }
      return { name, qty, unitPrice, totalPrice, details };
    });

  // Real, business-defined 17hats job fields only — e.g. "Themes & Colors", "On Site Point of
  // Contact". Once per import, never duplicated onto every line item.
  const customFields = {};
  ((raw.job && raw.job.custom_job_fields) || []).forEach(f => {
    if (f.deleted_yn) return;
    const name = f.custom_job_field && f.custom_job_field.name;
    if (name && f.value !== undefined && f.value !== null && f.value !== '') {
      customFields[name] = f.value;
    }
  });

  // Facts about the invoice itself, not business-defined fields — kept in its own small object
  // rather than mixed into customFields.
  const invoiceMeta = {
    number: raw.number || null,
    total: (raw.total_amount && raw.total_amount.formatted) || null,
    dueDate: raw.due_date || null,
  };

  return { clientName, rawItems, eventTitle, customFields, invoiceMeta };
}

module.exports = { normalizeInvoice, parseTokenizedDetails };
