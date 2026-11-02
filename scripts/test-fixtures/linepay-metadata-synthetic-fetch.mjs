// Synthetic-only subprocess fixture: no network request is made.
globalThis.fetch = async (_url, options) => {
  if (options.method !== 'GET' || options.redirect !== 'error' || options.cache !== 'no-store') throw new Error('unsafe request');
  return new Response(JSON.stringify({ envs: [
    { key: 'LINE_PAY_CHANNEL_ID', target: ['production'], value: 'fixture-private-value-never-print' },
    { key: 'LINE_PAY_CHANNEL_SECRET', target: ['preview'], value: 'fixture-private-value-never-print' },
    { key: 'fixture-private-value-never-print', target: ['production'], value: 'also-private' },
  ] }), { status: 200 });
};
