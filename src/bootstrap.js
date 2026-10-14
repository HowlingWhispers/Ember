/**
 * Protected browser bootstrap. Guest users have their own Ember session;
 * the legacy Orbis-linked /ember/scene route remains isolated.
 */
const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
if (!local) {
  try {
    const inLegacyScene = window.location.pathname === '/ember/scene';
    let response = await fetch(inLegacyScene ? '/ember/api/session' : '/ember/api/guest/session',
      { credentials:'same-origin',cache:'no-store' });
    if (!inLegacyScene && response.status === 401) {
      // Compatibility with a server where the opt-in guest mode is still disabled.
      response = await fetch('/ember/api/session',{credentials:'same-origin',cache:'no-store'});
    }
    if (!response.ok) throw new Error('Ember session unavailable');
    const session=await response.json();
    if (!session || !['world','character','sandbox'].includes(session.mode)
      || (session.mode === 'sandbox' ? session.asset !== null : session.asset?.type !== session.mode)
      || (inLegacyScene && session.identity === 'guest')) {
      throw new Error('Invalid Ember session');
    }
    globalThis.__EMBER_SESSION__=Object.freeze(session);
  } catch {
    document.querySelector('#app').innerHTML = '<div class="signed-out"><h1>Ember session unavailable</h1><p>Open Ember from the main entrance to reconnect your guest profile. Existing Orbis-launched scenes use their original session.</p><a href="/ember/">Return to Ember</a></div>';
  }
}
if (local || globalThis.__EMBER_SESSION__) await import('./app.js');
