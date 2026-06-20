// Generates a PayNow-compatible EMVCo Merchant-Presented-Mode QR payload.
//
// IMPORTANT: PayNow QR follows the EMVCo + SGQR specification. This
// implementation follows that published spec as commonly implemented by
// other open PayNow QR generators. Before relying on this in production,
// generate one test QR for a $0.01 amount and scan it with your own
// banking app to confirm it resolves to your account correctly. If your
// bank's app shows the wrong amount/payee, double check PAYNOW_PROXY_TYPE
// and PAYNOW_PROXY_VALUE in your .env file first.

const { crc16 } = require('./crc16');

function field(id, value) {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

/**
 * @param {object} opts
 * @param {'mobile'|'uen'} opts.proxyType
 * @param {string} opts.proxyValue - e.g. "+6591234567" or a UEN like "201912345A"
 * @param {number} opts.amount - order total, e.g. 12.5
 * @param {string} opts.reference - order code, shown as the payment reference
 * @param {string} opts.merchantName - business name (truncated to 25 chars)
 * @param {string} [opts.merchantCity]
 * @returns {string} the raw payload string to encode into a QR image
 */
function buildPayNowPayload({
  proxyType,
  proxyValue,
  amount,
  reference,
  merchantName,
  merchantCity = 'Singapore',
}) {
  if (!proxyValue) throw new Error('PAYNOW_PROXY_VALUE is not configured');

  const merchantAccountInfo =
    field('00', 'SG.PAYNOW') +
    field('01', proxyType === 'uen' ? '0' : '2') + // 0 = UEN, 2 = mobile number
    field('02', proxyValue) +
    field('03', '0'); // amount is NOT editable by the payer — exact total only

  const additionalData = field('01', String(reference).slice(0, 25));

  const amountStr = Number(amount).toFixed(2);

  let payload =
    field('00', '01') +                 // Payload Format Indicator
    field('01', '12') +                 // Point of Initiation: dynamic QR (has amount)
    field('26', merchantAccountInfo) +  // PayNow merchant account info
    field('52', '0000') +               // Merchant Category Code (unclassified)
    field('53', '702') +                // Transaction Currency: SGD
    field('54', amountStr) +            // Transaction Amount
    field('58', 'SG') +                 // Country Code
    field('59', String(merchantName).slice(0, 25)) +
    field('60', String(merchantCity).slice(0, 15)) +
    field('62', additionalData);

  const toCrc = payload + '6304';
  payload = toCrc + crc16(toCrc);

  return payload;
}

module.exports = { buildPayNowPayload };
