/**
 * AI Concierge — Gemini-powered, locked to Kloof Street businesses only.
 * Free tier: Google Gemini 2.0 Flash (no credit card required).
 * 
 * Env var required: GEMINI_API_KEY
 * Set in Vercel: vercel env add GEMINI_API_KEY
 */

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not set. Add it in Vercel env vars.' });
  }

  const { message, history = [], isStreetPassHolder = false } = req.body || {};

  if (!message || typeof message !== 'string' || message.length > 2000) {
    return res.status(400).json({ error: 'Message required (max 2000 chars)' });
  }

  // ── BUSINESS KNOWLEDGE BASE (only listed businesses) ──
  const businesses = [
    {
      name: 'Ubuntu Wellness',
      slug: '/ubuntu-wellness',
      address: '110 Kloof Street, Gardens, Cape Town',
      phone: '082 929 2544',
      whatsapp: 'https://wa.me/27829292544',
      category: 'Wellness & Spa',
      services: 'Float therapy (60-90 min), spa treatments, homeopathy consults, infrared sauna, qigong with Dr Thomas',
      hours: 'Mon-Sat, by appointment',
      streetPassBenefit: '10% off all treatments + priority booking',
      notes: 'Flagship wellness destination on Kloof Street. Float sessions are their signature experience.'
    },
    {
      name: 'On Safari - Wildlife Fine Art Photography',
      slug: '/on-safari',
      address: '99B Kloof Street, Gardens, Cape Town',
      phone: '021 422 1248',
      whatsapp: 'https://wa.me/27744815163',
      category: 'Art & Photography',
      services: 'Wildlife photographic fine art prints, framing, gallery viewing',
      hours: 'Mon-Thu 8am-5pm, Fri 8am-4pm, Sat 9am-12pm',
      streetPassBenefit: 'Free framing with each picture purchased + discount on shipping at PostNet',
      notes: 'Run by Nigel — wildlife photographer. Free to browse the gallery. Prints available for purchase. Featured in The Art & Aperitivo Street Pass Experience.'
    },
    {
      name: 'PostNet Gardens',
      slug: '/postnet-gardens',
      address: '55 Kloof Street, Gardens, Cape Town',
      phone: '021 422 1248',
      category: 'Printing & Courier',
      services: 'Printing, domestic and international courier, digital services, stationery',
      hours: 'Mon-Fri 9am-5pm, Sat 9am-1pm',
      streetPassBenefit: 'Discount on shipping for Street Pass holders (via On Safari Art & Aperitivo experience)',
      notes: 'Go-to for printing, courier and shipping on Kloof Street.'
    },
    {
      name: 'Dr Wendy Dicks',
      slug: '/dr-wendy-dicks',
      address: '99B Kloof Street, Gardens, Cape Town',
      phone: '021 111 0572',
      category: 'GP & Weight Loss',
      services: 'General practice, weight loss, GLP-1 treatments (Ozempic/Mounjaro), allergy testing, chronic conditions',
      hours: 'By appointment',
      streetPassBenefit: 'Priority booking for Street Pass holders',
      notes: 'MBChB (UP), DCH (SA). Specialises in weight loss and GLP-1 treatments. Family medicine.'
    },
    {
      name: 'Dr Thomas Jahn',
      slug: '/dr-thomas-jahn',
      address: '99 Kloof Street, Gardens, Cape Town',
      phone: '066 490 4382',
      category: 'Chinese Medicine & Acupuncture',
      services: 'Acupuncture, cupping, moxibustion, Tuina massage, Qigong, herbal medicine',
      hours: 'Thursdays 9am-5pm',
      streetPassBenefit: 'Priority booking for Street Pass holders',
      notes: 'Chinese medicine practitioner. Consults Thursdays at 99 Kloof Street. Also offers Qigong as part of the Wellness Morning Street Pass Experience.'
    },
    {
      name: 'Trudy Christians',
      slug: '/trudy-christians',
      address: '99B Kloof Street (Cape Town Medi-Spa), Gardens, Cape Town',
      phone: '078 832 4501',
      whatsapp: 'https://wa.me/27788324501',
      category: 'Aesthetics & Laser',
      services: 'Laser hair removal, laser skin rejuvenation, tattoo removal, Hollywood carbon laser, microdermabrasion, micro needling, body sculpting, red light therapy, hair loss solutions (Minoxidil/Finasteride), nasal spider veins, sun spot removal',
      hours: 'By appointment',
      streetPassBenefit: 'Priority booking + additional 5% off all September promo treatments',
      currentPromos: 'September Specials (Sept 2026 only): Nasal Spider Veins Removal R300, Red Light Therapy 20min R200, Sun Spot Hands Removal R300, 10% off Laser Hair Removal & RF Skin Tightening',
      notes: '30 years aesthetic experience. Works alongside plastic surgeons and dermatologists. September promos active now.'
    },
    {
      name: 'Just Hearing',
      slug: '/just-hearing',
      address: '99B Kloof Street, Gardens, Cape Town',
      category: 'Audiology',
      services: 'Hearing assessments (adults & children), hearing aids, tinnitus management',
      hours: 'By appointment',
      streetPassBenefit: 'Priority booking for Street Pass holders',
      notes: 'Patient-centred audiology practice.'
    },
    {
      name: 'Dr Dale Geoffreys',
      slug: '/dr-dale-geoffreys',
      address: '99B Kloof Street (Cape Town Medi-Spa), Gardens, Cape Town',
      phone: '021 203 5227',
      category: 'Plastic & Reconstructive Surgery',
      services: 'Botox, fillers, blepharoplasty, breast procedures, deep plane face and neck lift, abdominoplasty, liposuction',
      hours: 'By appointment',
      streetPassBenefit: 'Priority consultation for Collector tier Street Pass holders',
      notes: 'Fellowship-trained (CMSA 2013). Consults at Cape Town Medi-Spa 99B Kloof Street, operates at Alchimia Clinic 39 Kloof Street.'
    },
    {
      name: 'Hayley Schuter Physiotherapy',
      slug: '/hayley-schuter',
      address: '99B Kloof Street, Gardens, Cape Town',
      phone: '073 203 3726',
      category: 'Physiotherapy',
      services: 'Dry needling, sports massage, strapping, home visits',
      hours: 'By appointment',
      streetPassBenefit: 'Priority booking for Street Pass holders',
      notes: 'Qualified physiotherapist specialising in sports injuries and rehabilitation.'
    },
    {
      name: 'Body Vision Studio',
      slug: '/body-vision-studio',
      address: 'Lifestyle Centre, Level 2, 50 Kloof Street, Gardens, Cape Town',
      phone: '082 457 2118',
      whatsapp: 'https://wa.me/27824572118',
      category: 'Movement & Pilates',
      services: 'Private GYROTONIC sessions, semi-private sessions, GYROKINESIS, Classical Pilates mat, seniors programme, injury rehabilitation, online sessions',
      hours: 'By appointment',
      streetPassBenefit: '10% off all bookings — private sessions, semi-private and Pilates mat classes',
      notes: 'Run by Kim Tucker — certified GYROTONIC & Pilates instructor with 15+ years experience. GYROTONIC draws from gymnastics, swimming, ballet and yoga — fluid, circular, three-dimensional movement.'
    },
    {
      name: 'Revive Studio',
      slug: '/revive-studio',
      address: '99 Kloof Street, Gardens, Cape Town',
      phone: '084 525 7906',
      category: 'Massage & Beauty',
      services: 'Facials, massages, manicures, pedicures, lash and brow tinting, waxing',
      hours: 'By appointment',
      streetPassBenefit: 'Priority booking for Street Pass holders',
      notes: 'Holistic massage and beauty clinic by Nadine. Part of The Kloof Beauty Day Street Pass Experience.'
    }
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
    joinLink: '/streetpass/join',
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

  const expList = streetPassInfo.experiences.map(e => 
    `- **${e.name}** (${e.price}): ${e.detail}`
  ).join('\n');

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

  // ── BUILD GEMINI REQUEST ──
  const contents = [];

  // Add conversation history
  for (const msg of history) {
    if (msg.role === 'user' || msg.role === 'model') {
      contents.push({
        role: msg.role,
        parts: [{ text: msg.content }]
      });
    }
  }

  // Add current message
  contents.push({
    role: 'user',
    parts: [{ text: message }]
  });

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 800,
          topP: 0.9,
          topK: 40
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', response.status, errText);
      return res.status(502).json({ error: 'AI service error', status: response.status });
    }

    const data = await response.json();
    const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text 
      || 'I\'m having trouble right now — please try again in a moment.';

    return res.status(200).json({ reply: aiText });

  } catch (err) {
    console.error('AI chat error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
