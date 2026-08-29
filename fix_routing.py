with open('index.html','r') as f: h=f.read()

old = """// Initial routing
(function() {
  var page = routeFromPath();
  if (page !== 'home') { go(page, true); }
  // Set canonical state for home
  history.replaceState({page: page}, '', window.location.pathname || '/');
})();"""

new = """// Initial routing
(function() {
  var page = routeFromPath();
  if (page !== 'home') { go(page, true); }
  // Direct-load hook for Street Pass dynamic content
  if (page === 'streetpass') setTimeout(spLoadDashboard, 200);
  if (page === 'streetpass-scan') setTimeout(spInitScan, 400);
  if (page === 'streetpass-redeem') setTimeout(spLoadRewards, 200);
  // Set canonical state for home
  history.replaceState({page: page}, '', window.location.pathname || '/');
})();"""

if old in h:
    h = h.replace(old, new)
    with open('index.html','w') as f: f.write(h)
    print('[+] Added Street Pass direct-load hooks to IIFE')
else:
    print('[-] IIFE not found')
