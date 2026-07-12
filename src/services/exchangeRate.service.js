const https = require('https');

let cachedRates = null;
let cacheExpiry = 0;
const CACHE_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

// Hardcoded safe fallbacks if API is down
const FALLBACK_RATES = {
  INR: 1,
  USD: 0.012,
  EUR: 0.011,
  GBP: 0.0093,
  CAD: 0.016,
  AUD: 0.018,
  JPY: 1.85
};

async function fetchRatesFromApi() {
  return new Promise((resolve, reject) => {
    https.get('https://open.er-api.com/v6/latest/INR', (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.result === 'success' && parsed.rates) {
            resolve(parsed.rates);
          } else {
            reject(new Error('Invalid response format'));
          }
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function getExchangeRates() {
  const now = Date.now();
  if (cachedRates && now < cacheExpiry) {
    return cachedRates;
  }

  try {
    const rates = await fetchRatesFromApi();
    cachedRates = rates;
    cacheExpiry = now + CACHE_DURATION_MS;
    console.log('[EXCHANGE_RATE] Successfully fetched and cached live exchange rates.');
    return cachedRates;
  } catch (err) {
    console.error('[EXCHANGE_RATE] Failed to fetch live exchange rates, using fallbacks:', err.message);
    if (cachedRates) {
      return cachedRates;
    }
    return FALLBACK_RATES;
  }
}

function getSubunitMultiplier(currency) {
  const zeroDecimalCurrencies = ['JPY', 'KRW', 'CLP', 'VND', 'PYG'];
  return zeroDecimalCurrencies.includes(currency.toUpperCase()) ? 1 : 100;
}

/**
 * Converts INR paise to the target currency subunits (e.g., USD cents or JPY yen).
 * @param {number} amountInPaise - The amount in INR paise.
 * @param {string} targetCurrency - The target currency code (e.g. USD, EUR, JPY).
 * @returns {Promise<{ amount: number, rate: number }>} Converted amount in subunits and the exchange rate used.
 */
async function convertInrToTarget(amountInPaise, targetCurrency) {
  const currency = targetCurrency ? targetCurrency.toUpperCase() : 'INR';
  const rates = await getExchangeRates();
  
  const rate = rates[currency];
  if (!rate) {
    console.warn(`[EXCHANGE_RATE] Currency ${currency} not found in rates, falling back to INR.`);
    return { amount: amountInPaise, rate: 1 };
  }

  const amountInRupees = amountInPaise / 100;
  const convertedAmount = amountInRupees * rate;
  const multiplier = getSubunitMultiplier(currency);
  const amountInSubunits = Math.round(convertedAmount * multiplier);

  return {
    amount: amountInSubunits,
    rate
  };
}

module.exports = {
  getExchangeRates,
  convertInrToTarget,
  getSubunitMultiplier
};
