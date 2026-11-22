// Envoi des codes de connexion par SMS.
// SMS_PROVIDER=twilio  -> envoi réel (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)
// SMS_PROVIDER=console -> (par défaut) le code est écrit dans les journaux du serveur, pour tester
const PROVIDER = (process.env.SMS_PROVIDER || "console").toLowerCase();

async function sendSms(phone, text) {
  const to = `+216${phone}`;                 // numéros tunisiens à 8 chiffres
  if (PROVIDER === "twilio") {
    const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM || "", Body: text }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error("Échec SMS Twilio :", res.status, err.slice(0, 200));
      throw new Error("SMS non envoyé");
    }
    return;
  }
  console.log(`[SMS console] ${to} : ${text}`);
}

// En développement seulement, l'API renvoie le code pour pouvoir tester sans SMS
const exposeCodeForDev = () => PROVIDER === "console" && process.env.NODE_ENV !== "production";

module.exports = { sendSms, exposeCodeForDev, PROVIDER };
