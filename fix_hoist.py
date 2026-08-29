with open('index.html','r') as f: h=f.read()

# Move the initial routing IIFE to AFTER updateMeta function
iife = """// Initial routing
(function() {
  var page = routeFromPath();
  if (page !== 'home') { go(page, true); }
  // Set canonical state for home
  history.replaceState({page: page}, '', window.location.pathname || '/');
})();"""

# Remove the IIFE from its current position (before PAGE_META)
if iife in h:
    h = h.replace(iife, '// Initial routing (moved below updateMeta)\n')
    # Insert it after the updateMeta function's closing brace + blank line
    marker = """function updateMeta(name) {
  var m = PAGE_META[name] || PAGE_META['home'];
  document.title = m.title;
  var desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute('content', m.desc);
  var ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute('content', m.title);
  var ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) ogDesc.setAttribute('content', m.desc);
  var canon = document.querySelector('link[rel="canonical"]');
  var slug = SLUG_MAP[name] || '/' + name;
  if (canon) canon.setAttribute('href', 'https://kloofstreet.online' + slug);
}"""
    
    h = h.replace(marker, marker + '\n\n' + iife)
    with open('index.html','w') as f: f.write(h)
    print('[+] Moved initial routing IIFE after PAGE_META + updateMeta')
else:
    print('[-] IIFE not found')
