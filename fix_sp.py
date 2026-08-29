with open('index.html','r') as f: h=f.read()

# Fix spClient to reuse window._supabase if available
old = """function spClient() {
  if (!_spClient) {
    var url = (typeof SP_CONFIG !== 'undefined' && SP_CONFIG.url && SP_CONFIG.url.indexOf('PASTE_') !== 0) ? SP_CONFIG.url : '';
    var key = (typeof SP_CONFIG !== 'undefined' && SP_CONFIG.anonKey && SP_CONFIG.anonKey.indexOf('PASTE_') !== 0) ? SP_CONFIG.anonKey : '';
    if (!url || !key) {
      console.error('[Street Pass] Supabase keys not configured. Edit streetpass-config.js');
    }
    _spClient = supabase.createClient(url, key);
  }
  return _spClient;
}"""

new = """function spClient() {
  if (!_spClient) {
    if (window._supabase) {
      _spClient = window._supabase;
    } else {
      var url = (typeof SP_CONFIG !== 'undefined' && SP_CONFIG.url && SP_CONFIG.url.indexOf('PASTE_') !== 0) ? SP_CONFIG.url : '';
      var key = (typeof SP_CONFIG !== 'undefined' && SP_CONFIG.anonKey && SP_CONFIG.anonKey.indexOf('PASTE_') !== 0) ? SP_CONFIG.anonKey : '';
      if (!url || !key) {
        console.error('[Street Pass] Supabase keys not configured. Edit streetpass-config.js');
        return null;
      }
      try { _spClient = supabase.createClient(url, key); }
      catch(e) { console.error('[Street Pass] createClient failed:', e); return null; }
    }
  }
  return _spClient;
}"""

if old in h:
    h = h.replace(old, new)
    print('[+] spClient now reuses window._supabase')
else:
    print('[-] spClient not found')

# Also add null guard in spGetSession
old2 = 'return Promise.race([\n    spClient().auth.getSession()'
new2 = 'var client = spClient(); if (!client) return Promise.resolve(null);\n  return Promise.race([\n    client.auth.getSession()'

if old2 in h:
    h = h.replace(old2, new2)
    print('[+] Added null guard in spGetSession')
else:
    print('[-] spGetSession pattern not found')

with open('index.html','w') as f: f.write(h)
