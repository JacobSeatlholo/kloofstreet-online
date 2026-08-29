#!/usr/bin/env python3
"""
Comprehensive Lighthouse + SEO fix for kloofstreet.online index.html
Fixes: color contrast, heading order, crawlable links, render-blocking scripts,
burger aria-label, leftover Edge Fitness comment, preconnect hints.
"""
import re

with open('index.html', 'r', encoding='utf-8') as f:
    c = f.read()

print(f'Original size: {len(c)} bytes')
changes = 0

# 1. COLOR CONTRAST FIXES (light mode)
light_block = '[data-theme="light"]{--bg:#f5f4f0;--bg2:#ffffff;--bg3:#ede9e0;--bdr:rgba(0,0,0,.09);--muted:#5e5e5b;--text:#1a1a18;--text2:#0d0d0c;--a:#c9a200;--al:#e0b400;}'

if light_block in c:
    contrast_css = '''
[data-theme="light"] .btn-gold{color:#3d2e00}
[data-theme="light"] .accolade-item{color:#3d2e00}
[data-theme="light"] .dir-tab.active{color:#3d2e00}
[data-theme="light"] .footer-bot p{color:#50504b}
[data-theme="light"] .footer-bot a{color:#50504b}
[data-theme="light"] .footer-bot em{color:#8a6d00}'''
    c = c.replace(light_block, light_block + contrast_css, 1)
    changes += 1
    print('  [1] Light-mode contrast fixes (btn-gold, accolade, footer)')

# 2. HEADING ORDER - footer h4 to h3
footer_h4_count = len(re.findall(r'<h4>(Explore|Platform|Business Hustle)</h4>', c))
if footer_h4_count > 0:
    c = re.sub(r'<h4>(Explore|Platform|Business Hustle)</h4>', r'<h3>\1</h3>', c)
    changes += 1
    print(f'  [2] Changed {footer_h4_count} footer h4 to h3')

# 3. CRAWLABLE LINKS - Add href to onclick anchors
slug_map = {}
for m in re.finditer(r"'(\w[-\w]*)'\s*:\s*'/([^']*)'", c):
    slug_map[m.group(1)] = '/' + m.group(2)
slug_map['home'] = '/'
slug_map['listed'] = '/get-listed'
slug_map['dash'] = '/dashboard'
slug_map['streetpass'] = '/streetpass'
slug_map['streetpass-signup'] = '/streetpass/join'
slug_map['streetpass-scan'] = '/streetpass/scan'
slug_map['streetpass-redeem'] = '/streetpass/redeem'

fixed_count = 0
def add_href_to_tag(tag):
    global fixed_count
    if 'href' in tag.lower():
        return tag
    m = re.search(r"(?:go|mgo)\(['\"]([^'\"]+)['\"]\)", tag)
    if not m:
        return tag
    page = m.group(1)
    href = slug_map.get(page, '/' + page)
    tag = tag.replace('<a ', '<a href="' + href + '" ', 1)
    fixed_count += 1
    return tag

parts = []
last = 0
for m in re.finditer(r'<a\s[^>]*onclick="[^"]*(?:go|mgo)\([^)]*\)[^>]*>', c):
    parts.append(c[last:m.start()])
    parts.append(add_href_to_tag(m.group(0)))
    last = m.end()
parts.append(c[last:])
c = ''.join(parts)
if fixed_count:
    changes += 1
    print(f'  [3] Added href to {fixed_count} onclick anchors')

# 4a. FIX MISSING </script> ON streetpass-config.js
broken_tag = '<script src="streetpass-config.js"><script>'
fixed_tag = '<script src="streetpass-config.js"></script><script>'
if broken_tag in c:
    c = c.replace(broken_tag, fixed_tag, 1)
    changes += 1
    print('  [4a] Fixed missing </script> on streetpass-config.js')

# 4b. RENDER-BLOCKING SCRIPTS - Add defer (only supabase and html5-qrcode)
defer_pairs = [
    ('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>',
     '<script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>'),
    ('<script src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"></script>',
     '<script defer src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"></script>'),
]
for old, new in defer_pairs:
    if old in c:
        c = c.replace(old, new, 1)
        changes += 1
        name = old.split('/dist/')[-1].replace('"></script>','') if '/dist/' in old else old.split('/html5-qrcode@')[-1].replace('"></script>','')
        print(f'  [4b] Added defer to: {name}')

# 5. BURGER MENU ARIA-LABEL
if '<button class="burger"' in c:
    burger_pos = c.find('<button class="burger"')
    if 'aria-label' not in c[burger_pos:burger_pos+120]:
        c = c.replace('<button class="burger"', '<button class="burger" aria-label="Toggle navigation menu"', 1)
        changes += 1
        print('  [5] Added aria-label to burger menu')

# 6. REMOVE LEFTOVER EDGE FITNESS COMMENT
if 'EDGE FITNESS' in c:
    c = re.sub(r'\n?<!--[^>]*EDGE FITNESS[^>]*-->\n?', '', c)
    changes += 1
    print('  [6] Removed Edge Fitness comment')

# 7. PRECONNECT for CDN domains
head_end = c.find('</head>')
head_content = c[:head_end]
preconnects = [
    '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>',
    '<link rel="preconnect" href="https://unpkg.com" crossorigin>',
    '<link rel="dns-prefetch" href="https://plausible-production-63a6.up.railway.app">',
]
added_pc = 0
for pc in preconnects:
    if pc not in head_content:
        c = c[:head_end] + '\n  ' + pc + c[head_end:]
        head_end += len(pc) + 3
        added_pc += 1
if added_pc:
    changes += 1
    print(f'  [7] Added {added_pc} preconnect/dns-prefetch hints')

print(f'\nTotal changes: {changes}')
print(f'Final size: {len(c)} bytes')

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(c)
print('Saved index.html')
