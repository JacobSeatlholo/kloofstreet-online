/**
 * AI Concierge — Gemini-powered, locked to Kloof Street businesses only.
 * Free tier: Google Gemini 1.5 Flash (no credit card required).
 * 
 * Env var required: GEMINI_API_KEY
 * Set in Vercel dashboard → Settings → Environment Variables
 */

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const GEMINI_KEY = process.env.GEMINI_API_KEY;

  // ── DIAGNOSTIC: GET /api/ai-chat?debug=1 ──
  if (req.method === 'GET' && req.query?.debug === '1') {
    if (!GEMINI_KEY) {
      return res.status(200).json({ status: 'error', message: 'GEMINI_API_KEY not set in Vercel env vars', keyPresent: false });
    }
    try {
      const modelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`;
      const modelsRes = await fetch(modelsUrl);
      if (!modelsRes.ok) {
        const errText = await modelsRes.text();
        return res.status(200).json({ 
          status: 'error', 
          message: `API key rejected by Google (${modelsRes.status})`, 
          keyPresent: true,
          keyPrefix: GEMINI_KEY.substring(0, 8) + '...',
          apiResponse: errText.substring(0, 300)
        });
      }
      const modelsData = await modelsRes.json();
      const availableModels = (modelsData.models || []).map(m => m.name).filter(n => n.includes('gemini'));
      return res.status(200).json({ 
        status: 'ok', 
        message: 'API key is valid and working',
        keyPresent: true,
        keyPrefix: GEMINI_KEY.substring(0, 8) + '...',
        availableModels
      });
    } catch (err) {
      return res.status(200).json({ status: 'error', message: err.message, keyPresent: true });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not set. Add it in Vercel env vars.' });
  }

  const { message, history = [], isStreetPassHolder = false } = req.body || {};
  if (!message || typeof message !== 'string' || message.length > 2000) {
    return res.status(400).json({ error: 'Message required (max 2000 chars)' });
  }

  // ── BUSINESS KNOWLEDGE BASE (only listed businesses) ──
  const businesses = [
    { name: 'Ubuntu Wellness', slug: '/ubuntu-wellness', address: '110 Kloof Street', phone: '082 929 2544', whatsapp: 'https://wa.me/27829292544', category: 'Wellness & Spa', services: 'Float therapy (60-90 min), spa treatments, homeopathy consults, infrared sauna, qigong with Dr Thomas', hours: 'Mon-Sat, by appointment', streetPassBenefit: '10% off all treatments + priority booking', notes: 'Flagship wellness destination. Float sessions are their signature.' },
    { name: 'On Safari - Wildlife Fine Art Photography', slug: '/on-safari', address: '99B Kloof Street', phone: '021 422 1248', whatsapp: 'https://wa.me/27744815163', category: 'Art & Photography', services: 'Wildlife photographic fine art prints, framing, gallery viewing', hours: 'Mon-Thu 8am-5pm, Fri 8am-4pm, Sat 9am-12pm', streetPassBenefit: 'Free framing with each picture purchased + discount on shipping at PostNet', notes: 'Run by Nigel. Free to browse gallery. Prints available.' },
    { name: 'PostNet Gardens', slug: '/postnet-gardens', address: '55 Kloof Street', phone: '021 422 1248', category: 'Printing & Courier', services: 'Printing, domestic and international courier, digital services, stationery', hours: 'Mon-Fri 9am-5pm, Sat 9am-1pm', streetPassBenefit: 'Discount on shipping for Street Pass holders', notes: 'Go-to for printing, courier and shipping on Kloof Street.' },
    { name: 'Dr Wendy Dicks', slug: '/dr-wendy-dicks', address: '99B Kloof Street', phone: '021 111 0572', category: 'GP & Weight Loss', services: 'General practice, weight loss, GLP-1 treatments, allergy testing, chronic conditions', hours: 'By appointment', streetPassBenefit: 'Priority booking for Street Pass holders', notes: 'MBChB (UP), DCH (SA). Weight loss and GLP-1 specialist.' },
    { name: 'Dr Thomas Jahn', slug: '/dr-thomas-jahn', address: '99 Kloof Street', phone: '066 490 4382', category: 'Chinese Medicine & Acupuncture', services: 'Acupuncture, cupping, moxibustion, Tuina massage, Qigong, herbal medicine', hours: 'Thursdays 9am-5pm', streetPassBenefit: 'Priority booking for Street Pass holders', notes: 'Chinese medicine. Thursdays at 99 Kloof Street.' },
    { name: 'Trudy Christians', slug: '/trudy-christians', address: '99B Kloof Street (Cape Town Medi-Spa)', phone: '078 832 4501', whatsapp: 'https://wa.me/27788324501', category: 'Aesthetics & Laser', services: 'Laser hair removal, skin rejuvenation, tattoo removal, Hollywood carbon laser, microdermabrasion, micro needling, body sculpting, red light therapy, hair loss solutions', hours: 'By appointment', streetPassBenefit: 'Priority booking + additional 5% off all September promo treatments', currentPromos: 'September Specials (Sept 2026 only): Nasal Spider Veins Removal R300, Red Light Therapy 20min R200, Sun Spot Hands Removal R300, 10% off Laser Hair Removal & RF Skin Tightening', notes: '30 years aesthetic experience. September promos active now.' },
    { name: 'Just Hearing', slug: '/just-hearing', address: '99B Kloof Street', category: 'Audiology', services: 'Hearing assessments (adults & children), hearing aids, tinnitus management', hours: 'By appointment', streetPassBenefit: 'Priority booking for Street Pass holders', notes: 'Patient-centred audiology practice.' },
    { name: 'Dr Dale Geoffreys', slug: '/dr-dale-geoffreys', address: '99B Kloof Street (Cape Town Medi-Spa)', phone: '021 203 5227', category: 'Plastic & Reconstructive Surgery', services: 'Botox, fillers, blepharoplasty, breast procedures, deep plane face and neck lift, abdominoplasty, liposuction', hours: 'By appointment', streetPassBenefit: 'Priority consultation for Collector tier Street Pass holders', notes: 'Fellowship-trained (CMSA 2013). Consults at Medi-Spa 99B Kloof St.' },
    { name: 'Hayley Schuter Physiotherapy', slug: '/hayley-schuter', address: '99B Kloof Street', phone: '073 203 3726', category: 'Physiotherapy', services: 'Dry needling, sports massage, strapping, home visits', hours: 'By appointment', streetPassBenefit: 'Priority booking for Street Pass holders', notes: 'Sports injuries and rehabilitation specialist.' },
    { name: 'Body Vision Studio', slug: '/body-vision-studio', address: 'Lifestyle Centre, Level 2, 50 Kloof Street', phone: '082 457 2118', whatsapp: 'https://wa.me/27824572118', category: 'Movement & Pilates', services: 'Private GYROTONIC sessions, semi-private, GYROKINESIS, Classical Pilates mat, seniors programme, injury rehab, online sessions', hours: 'By appointment', streetPassBenefit: '10% off all bookings — private sessions, semi-private and Pilates mat classes', notes: 'Kim Tucker — certified GYROTONIC & Pilates instructor, 15+ years.' },
    { name: 'Revive Studio', slug: '/revive-studio', address: '99 Kloof Street', phone: '084 525 7906', category: 'Massage & Beauty', services: 'Facials, massages, manicures, pedicures, lash and brow tinting, waxing', hours: 'By appointment', streetPassBenefit: 'Priority booking for Street Pass holders', notes: 'Holistic massage and beauty clinic by Nadine.' }
  ];

  const streetPassInfo = {
    tiers: [
      { name: 'Explorer', price: 'R199/month', benefits: 'Discounts at all verified partners, WhatsApp flash deals, Member Night invitations, AI concierge access' },
      { name: 'Insider', price: 'R499/month', benefits: 'All Explorer benefits + bookable Kloof Street Experiences' },
      { name: 'Collector', price: 'R999/month', benefits: 'Two included experiences per month, bespoke concierge, Dr Dale priority consultation, cruise shore excursion priority' }
    ],
    experiences: [
      { name: 'The Wellness Morning', price: 'R1,550/person', detail: 'Float & Massage combo + brunch voucher at Arnold\'s' },
      { name: 'The Art & Aperitivo', price: 'Street Pass Exclusive', detail: 'Free framing with each picture from On Safari Photography + discount on shipping at PostNet' },
      { name: 'The Kloof Beauty Day', price: 'R2,850/person', detail: 'Revive Studio → Trudy Christians voucher → premium beauty experience' },
      { name: 'The Collector\'s Tour', price: 'R1,850/person', detail: 'On Safari print → lunch at Arnold\'s → 30-min massage at Ubuntu Wellness' }
    ],
    whatsapp: '+27 74 481 5163'
  };

  // ── BUILD SYSTEM PROMPT ──
  const spStatus = isStreetPassHolder 
    ? 'The user IS a Street Pass holder. Always mention their exclusive benefits when relevant.' 
    : 'The user is NOT a Street Pass holder. Mention Street Pass benefits as an upsell when relevant.';

  const businessList = businesses.map(b => {
    let info = `- **${b.name}** (${b.category}) — ${b.address}\n  Services: ${b.services}\n  Hours: ${b.hours}\n  Street Pass: ${b.streetPassBenefit}`;
    if (b.phone) info += `\n  Phone: ${b.phone}`;
    if (b.currentPromos) info += `\n  CURRENT PROMOS: ${b.currentPromos}`;
    if (b.notes) info += `\n  Notes: ${b.notes}`;
    return info;
  }).join('\n\n');

  const expList = streetPassInfo.experiences.map(e => `- **${e.name}** (${e.price}): ${e.detail}`).join('\n');

  const systemPrompt = `You are the Kloof Street AI Concierge for kloofstreet.online — the verified guide to Kloof Street, Cape Town (voted #22 World's Coolest Street by Time Out 2025).

${spStatus}

## CRITICAL RULES:
1. You ONLY recommend businesses listed below. NEVER invent or suggest businesses, restaurants, cafes, bars, or services not in this list.
2. If asked about something not available (e.g. restaurants, coffee shops, bars), say: "That's not currently listed on Kloof Street — our directory focuses on wellness, beauty, art, medical and movement businesses. Here's what I can help with..." and suggest relevant listed alternatives.
3. Always be specific — mention real business names, addresses, phone numbers, and Street Pass benefits.
4. When recommending a business, include their page link: https://kloofstreet.online${'{slug}'}
5. For booking, suggest WhatsApp or phone call with the real number.
6. Keep responses concise but helpful — use bullet points for lists.
7. Use South African Rand (R) for all prices.

## LISTED BUSINESSES (ONLY THESE):
${businessList}

## STREET PASS MEMBERSHIP:
- Explorer: ${streetPassInfo.tiers[0].price} — ${streetPassInfo.tiers[0].benefits}
- Insider: ${streetPassInfo.tiers[1].price} — ${streetPassInfo.tiers[1].benefits}
- Collector: ${streetPassInfo.tiers[2].price} — ${streetPassInfo.tiers[2].benefits}

Bookable Experiences:
${expList}

Join Street Pass: https://kloofstreet.online/streetpass/join
WhatsApp to join: ${streetPassInfo.whatsapp}

## ABOUT KLOOF STREET:
Kloof Street runs through Gardens/Tamboerskloof in Cape Town's City Bowl. It was voted #22 Coolest Street in the World by Time Out 2025. The directory at kloofstreet.online lists verified businesses — currently focused on wellness, medical, beauty, art and movement. Restaurants and bars exist on the street but are not yet in our directory.`;

  // ── BUILD CONVERSATION CONTENTS ──
  const contents = [];
  for (const msg of history) {
    if (msg.role === 'user' || msg.role === 'model') {
      contents.push({ role: msg.role, parts: [{ text: msg.content }] });
    }
  }
  contents.push({ role: 'user', parts: [{ text: message }] });

  // ── CALL GEMINI API ──
  // Try multiple models + API versions until one works
  const MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-2.5-flash'];
  const VERSIONS = ['v1beta', 'v1'];

  const requestBody = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 800, topP: 0.9, topK: 40 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
    ]
  };

  const errors = [];

  try {
    for (const version of VERSIONS) {
      for (const model of MODELS) {
        const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${GEMINI_KEY}`;
        
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });

          if (response.ok) {
            const data = await response.json();
            const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (aiText) {
              return res.status(200).json({ reply: aiText });
            }
            // Response came back empty
            errors.push(`${version}/${model}: empty response`);
            continue;
          }

          const errText = await response.text();
          const errObj = { model: `${version}/${model}`, status: response.status };
          try { const parsed = JSON.parse(errText); errObj.message = parsed?.error?.message || errText.substring(0, 150); } 
          catch(e) { errObj.message = errText.substring(0, 150); }
          errors.push(errObj);

          // If it's a 400 error, the model exists but request is bad — try without system_instruction
          if (response.status === 400) {
            const fallbackBody = { contents, generationConfig: requestBody.generationConfig, safetySettings: requestBody.safetySettings };
            // Prepend system prompt as first user message instead
            fallbackBody.contents.unshift({ role: 'user', parts: [{ text: systemPrompt }] });
            fallbackBody.contents.splice(1, 0, { role: 'model', parts: [{ text: 'Understood. I will only recommend businesses listed in the Kloof Street directory.' }] });

            const fb2 = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(fallbackBody)
            });

            if (fb2.ok) {
              const fb2Data = await fb2.json();
              const fb2Text = fb2Data?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (fb2Text) {
                return res.status(200).json({ reply: fb2Text });
              }
            }
          }

          // If 403 (API key issue) or 401, no point trying other models
          if (response.status === 403 || response.status === 401) {
            return res.status(502).json({ 
              error: 'API key issue', 
              detail: 'Your GEMINI_API_KEY was rejected. Go to aistudio.google.com → Get API Key → make sure you copied the full key. Then update it in Vercel env vars and redeploy.',
              errors 
            });
          }

        } catch (fetchErr) {
          errors.push({ model: `${version}/${model}`, error: fetchErr.message });
        }
      }
    }

    // All models failed
    return res.status(502).json({ 
      error: 'All Gemini models failed', 
      detail: 'Could not reach any Gemini model. Check your API key and that the Gemini API is enabled at aistudio.google.com',
      errors 
    });

  } catch (err) {
    console.error('AI chat error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
};
