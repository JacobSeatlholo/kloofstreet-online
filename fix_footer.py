with open('index.html','r') as f: h=f.read()

# Add "Resources" link to Business Hustle footer column
old = '<li><a href="https://www.hustleportal.online/" target="_blank">BH Platform</a></li>'
new = '<li><a href="https://www.hustleportal.online/" target="_blank">BH Platform</a></li>\n        <li><a href="https://www.businesshustle.co.za/#resources" target="_blank">Resources</a></li>'
h = h.replace(old, new, 1)

with open('index.html','w') as f: f.write(h)
print('[+] Added BH Resources link to footer')
