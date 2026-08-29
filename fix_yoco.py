with open('index.html','r') as f: h=f.read()

# 1. Replace EFT success screen with Pay Now button
old_success = """    <div class="sp-signup-wrap" id="spSignupSuccess" style="display:none;">
      <div class="sp-signup-success show">
        <div class="sp-signup-success-icon">&#x2705;</div>
        <div class="sp-signup-success-title">Account Created</div>
        <div class="sp-signup-success-desc">Your Street Pass account is ready. To activate your membership, please make the first payment below. We'll confirm within 24 hours.</div>
      </div>
      <div class="sp-eft">
        <div class="sp-eft-title">EFT Payment Details</div>
        <div class="sp-eft-row"><span>Bank</span><span>FNB</span></div>
        <div class="sp-eft-row"><span>Account Name</span><span>Simple Eternity Holdings (Pty) Ltd</span></div>
        <div class="sp-eft-row"><span>Account Number</span><span>6292 2517 185</span></div>
        <div class="sp-eft-row"><span>Branch Code</span><span>250655</span></div>
        <div class="sp-eft-row"><span>Reference</span><span id="spPaymentRef">STREETPASS</span></div>
        <div class="sp-eft-row"><span>Amount</span><span>R199.00</span></div>
      </div>
      <div style="text-align:center;margin-top:20px;">
        <a href="/streetpass" class="btn btn-gold" onclick="go('streetpass')" style="display:inline-block;">Go to Dashboard</a>
      </div>
    </div>"""

new_success = """    <div class="sp-signup-wrap" id="spSignupSuccess" style="display:none;">
      <div class="sp-signup-success show">
        <div class="sp-signup-success-icon">&#x2705;</div>
        <div class="sp-signup-success-title">Account Created</div>
        <div class="sp-signup-success-desc">Your Street Pass account is ready. Pay R199 to activate your membership and start earning points at every verified Kloof Street partner.</div>
      </div>
      <div style="text-align:center;margin-top:24px;">
        <button class="btn btn-gold" id="spPayBtn" onclick="spPayNow()" style="padding:14px 40px;font-size:14px;">
          Pay R199 via Yoco
        </button>
        <div id="spPayError" class="sp-signup-error" style="margin-top:12px;"></div>
        <div style="margin-top:16px;">
          <a href="#" onclick="go('home')" style="color:var(--muted);font-size:12px;text-decoration:none;">Skip for now &rarr;</a>
        </div>
      </div>
    </div>"""

h = h.replace(old_success, new_success)

# 2. Replace the spPaymentRef line in signup JS
old_ref = "      document.getElementById('spPaymentRef').textContent = 'SP-' + r.data.user.id.substring(0, 8).toUpperCase();"
new_ref = "      window._spPendingUserId = r.data.user.id;\n      window._spPendingEmail = email;"
h = h.replace(old_ref, new_ref)

# 3. Add spPayNow function before the spShowLogin function
pay_fn = """
// ── YOCO PAYMENT ──
function spPayNow() {
  var btn = document.getElementById('spPayBtn');
  var errEl = document.getElementById('spPayError');
  btn.textContent = 'Opening checkout...';
  btn.disabled = true;
  errEl.className = 'sp-signup-error';
  errEl.textContent = '';

  fetch('/api/create-checkout', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      userId: window._spPendingUserId,
      email: window._spPendingEmail,
      displayName: document.getElementById('sp-name') ? document.getElementById('sp-name').value : ''
    })
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
    } else {
      throw new Error(data.error || 'Could not create checkout');
    }
  }).catch(function(e) {
    errEl.textContent = e.message || 'Payment failed. Try again or contact us.';
    errEl.className = 'sp-signup-error show';
    btn.textContent = 'Pay R199 via Yoco';
    btn.disabled = false;
  });
}

"""

old_login = "function spShowLogin() {"
h = h.replace(old_login, pay_fn + old_login)

with open('index.html','w') as f: f.write(h)
print('[+] Replaced EFT screen with Yoco payment button')
