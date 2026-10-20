importScripts('ext-api.js');

const RULESET_ID = 'cdn_headers';
const ext = globalThis.moovieExt;

if (ext) {
  ext.onInstalled(() => {
    ext.enableCdnRuleset(RULESET_ID);
  });

  ext.onMessage((message, _sender, sendResponse) => {
    if (message?.type === 'MOOVIE_EXT_PING') {
      sendResponse(ext.pingResponse());
      return true;
    }
  });
}