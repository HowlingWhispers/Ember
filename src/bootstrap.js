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
    if (!session || !['world','character'].includes(session.mode)
      || session.asset?.type !== session.mode) throw new Error('Invalid Orbis session');
    globalThis.__EMBER_SESSION__ = Object.freeze(session);
  } catch {
    document.querySelector('#app').innerHTML = '<div class="signed-out"><h1>Open Ember through Orbis</h1><p>Sign in with Discord at Orbis and choose Roleplay in Ember on a Character or Enter world in Ember on a World.</p><a href="https://lib.thehowlingwhispers.com/">Return to Orbis</a></div>';
  }
}
if (local || globalThis.__EMBER_SESSION__) await import('./app.js');
