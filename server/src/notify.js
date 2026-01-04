import nodemailer from 'nodemailer';

export async function sendEmailIfConfigured(to, subject, html, attachments = []){
  try{
    if(!to) { console.log('[notify] No recipient; skipping email. Subject:', subject); return; }
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
    // Gmail app passwords are typically shown with spaces; remove them if present
    const pass = (SMTP_PASS || '').replace(/\s+/g,'');
    if(!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS){
      console.log('[notify] SMTP not configured; intended to:', to, 'Subject:', subject);
      return;
    }
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass }
    });
    const mail = { from: SMTP_FROM || SMTP_USER, to, subject, html };
    if (attachments && attachments.length) {
      mail.attachments = attachments;
    }
    await transporter.sendMail(mail);
    console.log('[notify] Email sent to', to);
  }catch(e){
    console.error('[notify] Failed to send email:', e.message);
  }
}
