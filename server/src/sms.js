export async function sendSmsIfConfigured(to, message){
  try{
    if(!to){
      console.log('[sms] No phone provided; skipping SMS.');
      return;
    }

    // Twilio expects E.164 (+<country><number>). For convenience in dev,
    // you can store just digits and provide SMS_COUNTRY_CODE (e.g. +91).
    const countryCode = process.env.SMS_COUNTRY_CODE;
    const digitsOnly = String(to).replace(/\D/g, '');
    const countryDigits = countryCode ? String(countryCode).replace(/\D/g, '') : '';
    let toE164;
    if(String(to).startsWith('+')){
      toE164 = String(to);
    } else if(countryCode){
      // If user stored number already contains the country digits (e.g. 91XXXXXXXXXX), don't prefix again.
      const alreadyHasCountry = countryDigits && digitsOnly.startsWith(countryDigits) && digitsOnly.length > 10;
      toE164 = alreadyHasCountry ? `+${digitsOnly}` : `${countryCode}${digitsOnly}`;
    } else {
      // No country code configured; best-effort
      toE164 = `+${digitsOnly}`;
    }

    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM } = process.env;
    if(!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM){
      console.log('[sms] Twilio not configured; intended to:', toE164, 'Message:', message);
      return;
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Messages.json`;
    const params = new URLSearchParams();
    params.set('From', TWILIO_FROM);
    params.set('To', toE164);
    params.set('Body', message);

    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if(!res.ok){
      const body = await res.text().catch(()=> '');
      console.log('[sms] Twilio send failed:', res.status, body);
      return;
    }

    console.log('[sms] SMS sent to', toE164);
  }catch(e){
    console.error('[sms] Failed to send SMS:', e.message);
  }
}
