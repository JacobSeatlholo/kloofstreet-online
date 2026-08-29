#!/usr/bin/env python3
"""Fix: supabase defer, contrast, headings, crawlable links, aria-label, llms.txt case"""
import re, sys, os

INDEX = sys.argv[1] if len(sys.argv) > 1 else 'index.html'
with open(INDEX, 'r', encoding='utf-8') as f:
    html = f.read()
original = html
changes = []

def log(msg):
    changes.append(msg)
    print(f'  [+] {msg}')

def replace(old, new, label):
    global html
    if old in html:
        html = html.replace(old, new, 1)
        log(label)
    else:
        print(f'  [-] SKIP: {label}')

# 1. Remove defer from Supabase UMD (THE KEY FIX for _supabase)
replace(
    '<script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js">',
    '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js">',
    'Remove defer from Supabase UMD script')

# 2. Add defer to html5-qrcode (non-critical)
replace(
    '<script src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js">',
    '<script defer src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js">',
    'Add defer to html5-qrcode')

# 3. Improve accolade badge contrast
replace(
    '.accolade-badge{background:rgba(245,197,24,.12);color:#F5C518;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;letter-spacing:.04em}',
    '.accolade-badge{background:rgba(245,197,24,.15);color:#f7d44e;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.04em}',
    'Improve accolade badge contrast')

# 4. Footer heading h4 -> h3
replace(
    'footer h4{font-size:13px;font-weight:700;color:var(--text);margin-bottom:14px;text-transform:uppercase;letter-spacing:.08em}',
    'footer h3{font-size:13px;font-weight:700;color:var(--text);margin-bottom:14px;text-transform:uppercase;letter-spacing:.08em}',
    'Footer CSS: h4 -> h3')

footer_match = re.search(r'<footer[^>]*>(.*?)</footer>', html, re.DOTALL)
if footer_match:
    fh = footer_match.group(0)
    nf = fh.replace('<h4', '<h3').replace('</h4>', '</h3>')
    c = fh.count('<h4')
    if c > 0:
        html = html.replace(fh, nf)
        log(f'Footer HTML: {c}x <h4> -> <h3>')

# 5. Add href to onclick-only anchors
pattern = r'(<a\s+onclick="go\(\'([^\']+)\'\)")([^>]*?)(?<!href=)>'
def add_href(m):
    ts, path, rest = m.group(1), m.group(2), m.group(3)
    if 'href=' not in ts + rest:
        return f'{ts} href="/{path}"{rest}>'
    return m.group(0)

before = html
html = re.sub(pattern, add_href, html)
if html != before:
    added = sum(1 for m in re.finditer(pattern, before) if 'href=' not in m.group(1)+m.group(3))
    log(f'Added href to {added} onclick-only anchors')

# 6. Burger aria-label
replace(
    '<div class="burger" onclick="toggleMenu()">',
    '<div class="burger" onclick="toggleMenu()" role="button" aria-label="Toggle navigation menu" tabindex="0">',
    'Burger: added aria-label + role')

# 7. Edge Fitness comment
html = html.replace('<!-- EDGE FITNESS REMOVED -->\n', '')
if html != original:
    log('Removed Edge Fitness comment')

# 8. Hayley "2 Locations in Gardens"
if '2 Locations in Gardens' in html:
    html = html.replace('2 Locations in Gardens', '')
    log('Removed "2 Locations in Gardens"')

if html != original:
    with open(INDEX, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'\n{len(changes)} changes written to {INDEX}')
else:
    print('\nNo HTML changes needed.')

# Fix llms.txt case
if os.path.exists('Llms.txt'):
    os.rename('Llms.txt', 'llms.txt')
    print('[+] Llms.txt -> llms.txt')
elif os.path.exists('llms.txt'):
    print('[-] llms.txt already correct')
