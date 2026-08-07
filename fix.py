with open('index.html', 'r') as f:
    h = f.read()

h = h.replace("'SUPABASE_URL_PLACEHOLDER'", "(typeof SP_CONFIG !== 'undefined' && SP_CONFIG.url) || ''")
h = h.replace("'SUPABASE_ANON_KEY_PLACEHOLDER'", "(typeof SP_CONFIG !== 'undefined' && SP_CONFIG.anonKey) || ''")
h = h.replace("spUser = r.data.session.user;\n      return spClient()", "spAccessToken = r.data.session.access_token;\n      spUser = r.data.session.user;\n      return spClient()")
h = h.replace("spUser.access_token", "spAccessToken")

with open('index.html', 'w') as f:
    f.write(h)

print('Verifying...')
if 'SUPABASE_URL_PLACEHOLDER' in h: print('ERROR: URL placeholder still present')
else: print('OK: URL placeholder gone')
if 'SUPABASE_ANON_KEY_PLACEHOLDER' in h: print('ERROR: Key placeholder still present')
else: print('OK: Key placeholder gone')
if 'spUser.access_token' in h: print('ERROR: access_token bug still present')
else: print('OK: access_token bug fixed')
