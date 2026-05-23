/**
 * Utilities for data normalization and cleaning.
 */

/**
 * Strips status prefixes (like PENDING:, VERIFIED:, etc.) from field values.
 * These prefixes are used by the backend for internal state tracking but
 * should not be shown to users in forms or saved back as part of the data.
 */
export const cleanFieldValue = (val) => {
  if (typeof val !== 'string') return val;
  
  // Strip prefixes like PENDING:, VERIFIED:, APPROVED:, POOL:, DOWNLOAD:, REPRINT:
  // Case-insensitive match followed by a colon.
  const cleaned = val.replace(/^(PENDING|VERIFIED|APPROVED|POOL|DOWNLOAD|REPRINT|VERIFY|STATUS):/i, '');
  
  // If the value was just "NOT_FOUND", return empty string for better UX in forms
  if (cleaned === 'NOT_FOUND') return '';
  
  return cleaned.trim();
};

/**
 * Strips status prefixes from all values in a field_data object.
 */
export const cleanFieldData = (fieldData) => {
  if (!fieldData || typeof fieldData !== 'object') return {};
  
  const cleaned = {};
  for (const key in fieldData) {
    cleaned[key] = cleanFieldValue(fieldData[key]);
  }
  return cleaned;
};
