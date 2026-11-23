// Notifications Web Push, communes au client et au personnel.
// Elles arrivent sur l'écran du téléphone même app fermée (service worker sw.js).
// iPhone : seulement si le 707 est ajouté à l'écran d'accueil (Partager → Sur l'écran d'accueil), iOS 16.4 minimum.

const WebPush = (() => {
  const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  // iPhone dans Safari (pas depuis l'icône) : il faut d'abord ajouter l'app à l'écran d'accueil
  const needsInstall = () => isIos() && !standalone();
  const permission = () => ("Notification" in window ? Notification.permission : "denied");

  // À appeler pendant un geste (toucher un bouton), sinon le téléphone refuse de demander
  function ask() {
    if (!("Notification" in window)) return Promise.resolve("denied");
    if (Notification.permission !== "default") return Promise.resolve(Notification.permission);
    try { return Promise.resolve(Notification.requestPermission()).catch(() => "denied"); }
    catch { return Promise.resolve("denied"); }
  }

  const b64ToBytes = (s) => {
    const raw = atob((s + "=".repeat((4 - s.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  };
  const sameKey = (buf, bytes) => {
    if (!buf) return false;
    const a = new Uint8Array(buf);
    return a.length === bytes.length && a.every((v, i) => v === bytes[i]);
  };

  // as : "client" ou "staff" ; token : la session correspondante
  async function subscribe(as, token) {
    if (!supported() || permission() !== "granted" || !token) return false;
    try {
      await navigator.serviceWorker.register("sw.js");
      const reg = await navigator.serviceWorker.ready;
      const { key } = await (await fetch("/api/push/key")).json();
      const bytes = b64ToBytes(key);
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub.options.applicationServerKey, bytes)) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ as, subscription: sub.toJSON() }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Déconnexion : ce téléphone ne reçoit plus rien pour ce compte
  async function unsubscribe() {
    if (!supported()) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (!sub) return;
      await fetch("/api/push/unsubscribe", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe();
    } catch {}
  }

  // Texte à montrer quand les notifications ne sont pas actives
  function hint() {
    if (needsInstall()) return "Sur iPhone : touche Partager puis « Sur l'écran d'accueil », ouvre le 707 depuis l'icône, puis active les notifications.";
    if (!supported()) return "Ce navigateur ne reçoit pas les notifications.";
    if (permission() === "denied") return "Notifications bloquées : autorise-les dans les réglages du navigateur pour ce site.";
    return "";
  }

  return { supported, needsInstall, permission, ask, subscribe, unsubscribe, hint };
})();
