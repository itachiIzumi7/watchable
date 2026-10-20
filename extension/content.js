/** Moovie extension content script — v1.5.2 (cross-browser, no script injection) */
(function initMoovieStreamBoost() {
  const ext = globalThis.moovieExt;
  const version = ext?.getVersion?.() ?? '1.5.2';

  const API = {
    active: true,
    version,
    mode: 'direct-cdn',
  };

  function markDom() {
    const root = document.documentElement;
    if (!root) return;
    root.dataset.moovieExt = 'active';
    root.dataset.moovieExtVersion = API.version;
  }

  function signalReady() {
    markDom();
    window.dispatchEvent(
      new CustomEvent('moovie-stream-ext-ready', { detail: API })
    );
  }

  function signalPong() {
    window.dispatchEvent(
      new CustomEvent('moovie-stream-ext-pong', { detail: API })
    );
  }

  signalReady();

  window.addEventListener('moovie-ext-ping', signalPong);
})();