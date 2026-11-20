/*
 * Chirograph "Pay with USDC" button for Bitcoin Cash merchants.
 *
 *   <script src="https://<app>/pay.js"
 *           data-to="bitcoincash:z..."      // where the PUSD should land (token-aware address)
 *           data-amount="2.50"             // price in dollars
 *           data-label="Order 1042"
 *           data-token="PUSD"></script>        // PUSD (default) or MUSD
 *
 * Renders a button; clicking it opens the Chirograph checkout in a modal. The payer signs one USDC
 * authorization on Base or Arbitrum and the merchant receives PUSD (or MUSD) on Bitcoin Cash. The page is told
 * about the result through a `chirograph:paid` DOM event on the script's button.
 */
(function () {
  var script = document.currentScript;
  // The host page may have removed the tag before it ran (frameworks re-render); then there is nowhere to draw.
  if (!script || !script.parentNode) return;
  var origin = new URL(script.src).origin;
  var to = script.getAttribute('data-to') || '';
  var amount = script.getAttribute('data-amount') || '';
  var label = script.getAttribute('data-label') || '';
  var token = (script.getAttribute('data-token') || 'PUSD').toUpperCase() === 'MUSD' ? 'MUSD' : 'PUSD';
  if (!/^(bitcoincash|bchtest):[zrqp][a-z0-9]{40,}$/.test(to) || !/^\d+(\.\d{1,2})?$/.test(amount)) {
    console.warn('[chirograph] pay.js needs data-to (cashaddr) and data-amount (dollars, 2 decimals)');
    return;
  }

  var button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Pay $' + Number(amount).toFixed(2) + ' with USDC';
  button.setAttribute('data-chirograph-pay', '');
  button.style.cssText = 'font:500 15px/1 system-ui,sans-serif;padding:12px 18px;border-radius:10px;border:1px solid rgba(0,0,0,.12);background:#111;color:#fff;cursor:pointer';
  script.parentNode.insertBefore(button, script.nextSibling);

  var overlay;
  function close() {
    if (overlay) { overlay.remove(); overlay = null; }
  }
  button.addEventListener('click', function () {
    var url = origin + '/pay?to=' + encodeURIComponent(to) + '&amount=' + encodeURIComponent(amount) +
      '&label=' + encodeURIComponent(label) + '&token=' + token + '&embed=1';
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(10,10,10,.45);display:flex;align-items:center;justify-content:center;padding:16px';
    var frame = document.createElement('iframe');
    frame.src = url;
    frame.title = 'Chirograph checkout';
    frame.allow = 'clipboard-write';
    frame.style.cssText = 'width:100%;max-width:440px;height:620px;max-height:calc(100vh - 32px);border:0;border-radius:16px;background:#fff';
    overlay.appendChild(frame);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  });

  window.addEventListener('message', function (e) {
    if (e.origin !== origin || !e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'chirograph:close') close();
    if (e.data.type === 'chirograph:paid') {
      button.dispatchEvent(new CustomEvent('chirograph:paid', { bubbles: true, detail: e.data.detail }));
    }
  });
})();
