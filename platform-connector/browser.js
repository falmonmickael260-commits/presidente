// Shared bridge: native seat credentials only travel to the exact platform origin.
export function connectPlatform({ game, session, adopt, platform = (typeof location !== 'undefined' && location.hostname === 'localhost' ? 'http://localhost:3100' : 'https://revanchegames-production.up.railway.app') }) {
  if (typeof window === 'undefined') return () => {};
  let launch = null, adopted = null, lastState = '', lastSent = 0;
  const embedded = window.parent !== window;
  const origin = new URL(platform).origin;
  if (!embedded) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = 'Inviter un ami';
    button.style.cssText = 'position:fixed;left:12px;bottom:max(12px,env(safe-area-inset-bottom));z-index:1000;padding:10px 14px;border:1px solid #38c4ff;border-radius:16px;background:#111827;color:white;font:600 14px system-ui';
    button.addEventListener('click', async () => {
      // Open synchronously: Safari blocks windows opened after awaiting fetch.
      const tab = window.open('about:blank', '_blank');
      if (tab) tab.opener = null;
      try {
        let identity = new URLSearchParams(location.search).get('rg_token');
        try { identity ||= sessionStorage.getItem('rg_token'); } catch { /* unavailable */ }
        const response = await fetch('/api/platform/context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: session(), identity }) });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || 'Invitation indisponible.');
        const url = `${origin}/invite?context=${encodeURIComponent(value.context)}`;
        if (tab) tab.location.href = url; else window.open(url, '_self');
      } catch (error) { tab?.close(); alert(error.message); }
    });
    document.body.appendChild(button);
  }
  const send = () => {
    if (!embedded || !launch) return;
    const value = session();
    const state = JSON.stringify(value);
    if (state === lastState && Date.now() - lastSent < 20000) return;
    lastState = state; lastSent = Date.now();
    window.parent.postMessage({ type: 'rg:room', v: 1, game, launch, session: value }, origin);
  };
  const receive = async (event) => {
    if (!embedded || event.source !== window.parent || event.origin !== origin || event.data?.v !== 1 || event.data?.game !== game || event.data?.type !== 'rg:bootstrap') return;
    launch = event.data.launch;
    const admission = event.data.admission;
    if (admission && admission.id !== adopted) {
      adopted = admission.id;
      try { await adopt(admission.session); send(); }
      catch { adopted = null; window.parent.postMessage({ type: 'rg:join-error', v: 1, game, launch }, origin); }
    } else send();
  };
  window.addEventListener('message', receive);
  const timer = setInterval(send, 1000);
  const change = () => send();
  window.addEventListener('rg:session', change);
  const ready = () => embedded && window.parent.postMessage({ type: 'rg:ready', v: 1, game }, origin);
  ready(); const retry = setInterval(() => { if (!launch) ready(); }, 1000);
  return () => { clearInterval(timer); clearInterval(retry); window.removeEventListener('message', receive); window.removeEventListener('rg:session', change); };
}
