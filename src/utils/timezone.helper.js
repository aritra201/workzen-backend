const { DateTime } = require('luxon');
const { AppError } = require('./AppError');

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * Primary IANA timezone per country name or ISO code (lowercase keys).
 * Used when admin sets `country` without an explicit `timezone` (FR-011).
 */
const COUNTRY_TO_TIMEZONE = new Map([
  ['india', 'Asia/Kolkata'],
  ['in', 'Asia/Kolkata'],
  ['united states', 'America/New_York'],
  ['usa', 'America/New_York'],
  ['us', 'America/New_York'],
  ['united kingdom', 'Europe/London'],
  ['uk', 'Europe/London'],
  ['gb', 'Europe/London'],
  ['united arab emirates', 'Asia/Dubai'],
  ['uae', 'Asia/Dubai'],
  ['ae', 'Asia/Dubai'],
  ['singapore', 'Asia/Singapore'],
  ['sg', 'Asia/Singapore'],
  ['australia', 'Australia/Sydney'],
  ['au', 'Australia/Sydney'],
  ['canada', 'America/Toronto'],
  ['ca', 'America/Toronto'],
  ['germany', 'Europe/Berlin'],
  ['de', 'Europe/Berlin'],
  ['france', 'Europe/Paris'],
  ['fr', 'Europe/Paris'],
  ['japan', 'Asia/Tokyo'],
  ['jp', 'Asia/Tokyo'],
  ['bangladesh', 'Asia/Dhaka'],
  ['bd', 'Asia/Dhaka'],
  ['nepal', 'Asia/Kathmandu'],
  ['np', 'Asia/Kathmandu'],
  ['sri lanka', 'Asia/Colombo'],
  ['lk', 'Asia/Colombo'],
]);

function isValidIanaTimezone(timezone) {
  return typeof timezone === 'string' && timezone.length > 0 && DateTime.now().setZone(timezone).isValid;
}

function timezoneForCountry(country) {
  if (!country || typeof country !== 'string') {
    return null;
  }
  const key = country.trim().toLowerCase();
  return COUNTRY_TO_TIMEZONE.get(key) ?? null;
}

/**
 * Picks the timezone to store after a profile update.
 * Explicit `timezone` wins; otherwise derive from `country` when provided.
 */
function resolveCompanyTimezone({ explicitTimezone, country, currentTimezone }) {
  if (explicitTimezone !== undefined && explicitTimezone !== null && explicitTimezone !== '') {
    if (!isValidIanaTimezone(explicitTimezone)) {
      throw new AppError('Invalid IANA timezone', 400);
    }
    return explicitTimezone;
  }

  if (country !== undefined && country !== null && country !== '') {
    const fromCountry = timezoneForCountry(country);
    if (fromCountry) {
      return fromCountry;
    }
  }

  if (currentTimezone && isValidIanaTimezone(currentTimezone)) {
    return currentTimezone;
  }

  return DEFAULT_TIMEZONE;
}

module.exports = {
  DEFAULT_TIMEZONE,
  isValidIanaTimezone,
  timezoneForCountry,
  resolveCompanyTimezone,
};
