// Cherche une photo libre de droits pour chaque produit du menu de départ (Wikimedia Commons, API officielle)
// et l'enregistre dans db/photos/<id>.jpg, avec l'auteur et la licence dans db/photos/credits.json.
// Licences acceptées : CC0, domaine public, CC BY, CC BY-SA (utilisables dans un commerce, en citant l'auteur).
// Usage : node scripts/fetch-photos.js            (ne retélécharge pas une photo déjà présente)
//         node scripts/fetch-photos.js 16 23       (refait seulement ces produits, avec la photo suivante)
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "db", "photos");
const CREDITS = path.join(DIR, "credits.json");
const UA = "cafe707-menu/1.0 (menu photos; Node.js)";

// id produit -> recherches (en anglais, plus de résultats), de la plus précise à la plus large
const QUERIES = {
  1: ["espresso cup", "espresso"], 14: ["cappuccino cup", "cappuccino"], 15: ["americano coffee", "black coffee cup"],
  16: ["caffe latte cup", "latte coffee"], 17: ["cup of hot chocolate", "hot chocolate drink"], 18: ["espresso shot cup", "espresso coffee"],
  19: ["latte macchiato glass", "latte macchiato"], 20: ["green tea in glass", "glass of green tea"], 21: ["herbal tea cup", "chamomile tea"],
  22: ["iced coffee glass", "iced coffee"], 23: ["iced caramel latte", "caramel iced coffee"], 24: ["iced latte cinnamon", "iced latte"],
  25: ["coffee frappe glass", "iced blended coffee"], 26: ["chocolate milkshake whipped cream", "chocolate frappe"],
  27: ["glass of water", "water glass"], 28: ["cola glass ice", "cola drink"],
  29: ["passion fruit juice glass", "passion fruit smoothie"], 30: ["pina colada", "pina colada cocktail"],
  31: ["mojito", "mojito glass"], 3: ["hookah pipe", "shisha pipe"], 32: ["lemon juice glass", "lemonade drink glass ice"],
  33: ["orange juice on table", "glass of fresh orange juice"], 34: ["apple juice glass", "apple juice"],
  35: ["crepe with cheese", "savory crepe ham cheese"], 36: ["savory crepe meat", "galette complete"],
  6: ["crepe with chocolate", "chocolate crepe"], 37: ["crepe caramel", "crepe with caramel"],
  38: ["strawberry cheesecake slice", "cheesecake with strawberries"], 39: ["caramel cheesecake slice", "cheesecake with caramel sauce"],
  40: ["berry cheesecake", "raspberry cheesecake"], 41: ["lemon cheesecake", "cheesecake"],
  7: ["caesar salad", "chicken caesar salad"], 8: ["pizza margherita", "pizza"], 10: ["coffee with milk cup", "cafe con leche"],
  11: ["orange juice", "glass of orange juice"], 12: ["croissant", "croissants"], 13: ["omelette", "omelet plate"],
};

const OK_LICENSE = /^(cc0|public domain|pd|cc by(-sa)? [1-4]\.0)/i;
const strip = (html) => String(html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function search(q) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  Object.entries({
    action: "query", format: "json", generator: "search", gsrsearch: `${q} filetype:bitmap`, gsrnamespace: "6",
    gsrlimit: "20", prop: "imageinfo", iiprop: "url|mime|size|extmetadata", iiurlwidth: "640",
  }).forEach(([k, v]) => u.searchParams.set(k, v));
  let res;
  // Wikimedia limite le débit : on patiente et on réessaie
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch(u, { headers: { "User-Agent": UA } });
    if (res.status !== 429) break;
    await sleep(15000 * (attempt + 1));
  }
  if (!res.ok) throw new Error(`Commons ${res.status}`);
  const j = await res.json();
  return Object.values((j.query && j.query.pages) || {}).sort((a, b) => a.index - b.index);
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const credits = fs.existsSync(CREDITS) ? JSON.parse(fs.readFileSync(CREDITS, "utf8")) : {};
  const only = process.argv.slice(2).map(Number).filter(Boolean);
  const used = new Set(Object.values(credits).map(c => c.file));
  const skipFor = (id) => (only.includes(id) && credits[id] ? credits[id].file : null);

  for (const [idStr, queries] of Object.entries(QUERIES)) {
    const id = Number(idStr);
    const target = path.join(DIR, `${id}.jpg`);
    if (only.length && !only.includes(id)) continue;
    if (!only.length && fs.existsSync(target)) continue;
    const avoid = skipFor(id);
    let done = false;
    for (const q of queries) {
      const pages = await search(q).catch(e => { console.log(`  ${id} : ${e.message}`); return []; });
      for (const p of pages) {
        const ii = p.imageinfo && p.imageinfo[0];
        if (!ii || ii.mime !== "image/jpeg" || !ii.thumburl) continue;
        if (ii.width < 600 || ii.width / ii.height > 1.9 || ii.height / ii.width > 1.6) continue;
        if (used.has(p.title) || p.title === avoid) continue;
        if (/painting|portrait|woman|\bman\b|\bmen\b|girl|boy|people|museum|wga\d|gallery/i.test(p.title)) continue;
        const meta = ii.extmetadata || {};
        const license = strip(meta.LicenseShortName && meta.LicenseShortName.value);
        if (!OK_LICENSE.test(license) || /nc|nd/i.test(license.replace(/^cc0/i, ""))) continue;
        const img = await fetch(ii.thumburl, { headers: { "User-Agent": UA } });
        if (!img.ok) continue;
        fs.writeFileSync(target, Buffer.from(await img.arrayBuffer()));
        credits[id] = {
          file: p.title, author: strip(meta.Artist && meta.Artist.value) || "Inconnu", license,
          source: ii.descriptionurl, query: q,
        };
        used.add(p.title);
        console.log(`OK ${String(id).padStart(2)} · ${q} · ${license} · ${p.title.slice(5, 70)}`);
        done = true;
        break;
      }
      if (done) break;
      await sleep(1500);
    }
    if (!done) console.log(`-- ${id} : aucune photo libre trouvée`);
    fs.writeFileSync(CREDITS, JSON.stringify(credits, null, 2));
    await sleep(2500);
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
