const realFetch = globalThis.fetch;
const testOrigin = process.env.CCC_SUPABASE_TEST_ORIGIN;

if (typeof testOrigin !== 'string' || testOrigin === '') {
  throw new Error('CCC_SUPABASE_TEST_ORIGIN is required');
}

globalThis.fetch = (input, init) => {
  const requested = new URL(input instanceof Request ? input.url : input);
  if (requested.origin !== 'https://api.supabase.com') {
    throw new Error('bootstrap requested an unexpected Management API origin');
  }
  const target = new URL(`${requested.pathname}${requested.search}`, testOrigin);
  return realFetch(target, init);
};
