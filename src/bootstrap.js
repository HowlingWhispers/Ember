/**
 * Browser bootstrap. The server, not this script, protects app files.
 * Localhost remains a clearly labelled offline UI preview.
 */
const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
if (!local) {
  try {
    const response = await fetch('/ember/api/session', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('Orbis session required');
    const session = await response.json();
    if (!session || !['world','character','sandbox'].includes(session.mode)
      || (session.mode === 'sandbox' ? session.asset !== null : session.asset?.type !== session.mode)) {
      throw new Error('Invalid Orbis session');
    }
    globalThis.__EMBER_SESSION__ = Object.freeze(session);
  } catch {
    document.querySelector('#app').innerHTML = '<div class="signed-out"><h1>Ember session unavailable</h1><p>Open Ember directly to reconnect your Orbis login and begin a free sandbox. You never need to choose a world or character first.</p><a href="/ember/">Reconnect to Ember</a></div>';
  }
}
if (local || globalThis.__EMBER_SESSION__) await import('./app.js');
