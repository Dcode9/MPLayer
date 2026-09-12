
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryYoutubeError = (error) => {
  const status = Number(error?.response?.status || 0);
  const code = String(error?.code || '').toUpperCase();
  const reasons = Array.isArray(error?.response?.data?.error?.errors)
    ? error.response.data.error.errors.map((entry) => String(entry?.reason || '').toLowerCase())
    : [];

  if (status >= 500 || status === 429 || status === 408) {
    return true;
  }

  if (['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNABORTED'].includes(code)) {
    return true;
  }

  return reasons.some((reason) => [
    'backenderror',
    'internalerror',
    'ratelimitexceeded',
    'userratelimitexceeded',
    'quotaexceeded',
    'uploadratelimitexceeded',
  ].includes(reason));
};

// NOTE: This is a partial reconstruction of phase7-part-b.
// The full original part-b from the complete file must be used.
// Loading from local complete file...

module.exports = {
  runPhase7Upload: async () => {
    throw new Error('phase7-part-b is incomplete in this push - full content needed');
  },
};
