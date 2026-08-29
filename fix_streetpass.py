with open('index.html','r') as f: h=f.read()

old = """function spGetSession() {
  return spClient().auth.getSession().then(function(r) {
    if (r.data.session) {
      spAccessToken = r.data.session.access_token;
      spUser = r.data.session.user;
      return spClient().from('profiles').select('*').eq('id', spUser.id).single();
    }
    return { data: null };
  }).then(function(r) {
    spProfile = r.data;
    return spProfile;
  }).catch(function(e) {
    console.warn('[Street Pass] getSession error:', e.message || e);
    return null;
  });
}"""

new = """function spGetSession() {
  var timeout = new Promise(function(resolve) { setTimeout(function() { resolve(null); }, 5000); });
  return Promise.race([
    spClient().auth.getSession().then(function(r) {
      if (r.data.session) {
        spAccessToken = r.data.session.access_token;
        spUser = r.data.session.user;
        return spClient().from('profiles').select('*').eq('id', spUser.id).single();
      }
      return { data: null };
    }).then(function(r) {
      spProfile = r.data;
      return spProfile;
    }).catch(function(e) {
      console.warn('[Street Pass] getSession error:', e.message || e);
      return null;
    }),
    timeout
  ]);
}"""

if old in h:
    h = h.replace(old, new)
    with open('index.html','w') as f: f.write(h)
    print('[+] Added 5s timeout to spGetSession')
else:
    print('[-] spGetSession not found (already patched?)')
