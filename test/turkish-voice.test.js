// Turkish copy is impersonal (brand/ai/BRAND.md §11): no second-person possessives ("verinizi", "siteniz"), no "siz",
// and no imperatives that address the person ("kontrol edin", "bağlayın"). Scans every Turkish string in src/ and the
// Turkish text of the metric and check YAML. The allowlist holds the strings that mention those forms on purpose.
import "./setup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../src/config.js";

const POSSESSIVE = /[aeıioöuü]n[ıiuü]z(?:[a-zçğıöşü]*)$/; // veri-niz-i, site-niz, iste-diğ-iniz-de
const PRONOUN = /^siz(?:in|e|i|de|den|ce)?$/;
const IMPERATIVE_WORDS = new Set(["edin", "seçin", "geçin", "yapın", "girin", "alın", "bakın", "tutun", "verin", "açın", "silin", "gidin", "yazın", "başlatın", "kaldırın", "çalıştırın", "değiştirin", "aktarın", "kullanın", "oluşturun", "kaydedin", "gönderin", "düzeltin", "bağlayın", "deneyin", "ekleyin", "bekleyin", "tıklayın", "yükleyin", "izleyin", "eşitleyin", "isteyin", "sorun"]);
const VOWEL_Y_IMPERATIVE = /[aeıioöuü]y[ıiuü]n$/; // dene-yin, bağla-yın, ekle-yin
// Words that end like those forms but are not second person.
const NOT_SECOND_PERSON = new Set(["sorun", "yalnızca", "kolayın", "deniz", "denizli"]);
// Strings that name the forms on purpose: the agent's instruction to write impersonally.
const ALLOWED_STRINGS = [/never "siz" or possessives like/];

/** The second-person words in one Turkish text. */
export function secondPerson(text) {
  const out = [];
  for (const raw of text.match(/[A-Za-zçğıöşüÇĞİÖŞÜ]+/g) ?? []) {
    const w = raw.toLocaleLowerCase("tr");
    if (NOT_SECOND_PERSON.has(w)) continue;
    if (PRONOUN.test(w) || (w.length > 4 && POSSESSIVE.test(w)) || IMPERATIVE_WORDS.has(w) || (w.length > 5 && VOWEL_Y_IMPERATIVE.test(w))) out.push(raw);
  }
  return out;
}

const TURKISH = /[çğıöşüÇĞİÖŞÜ]| (?:ve|bir|için|ile|veya|yok|daha)\b/;
function turkishStrings() {
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".js")) {
        for (const m of readFileSync(p, "utf8").matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`|'((?:[^'\\\n]|\\.)*)'/g)) {
          const s = m[1] ?? m[2] ?? m[3];
          if (TURKISH.test(s)) out.push([path.relative(ROOT, p), s]);
        }
      }
    }
  };
  walk(path.join(ROOT, "src"));
  for (const dir of ["metrics", "checks"]) {
    for (const f of readdirSync(path.join(ROOT, dir)).filter((x) => x.endsWith(".yaml"))) {
      for (const m of readFileSync(path.join(ROOT, dir, f), "utf8").matchAll(/\btr: *"((?:[^"\\]|\\.)*)"/g)) out.push([`${dir}/${f}`, m[1]]);
    }
  }
  return out;
}

test("no second-person Turkish in server copy, metric definitions or checks", () => {
  const strings = turkishStrings();
  assert.ok(strings.length > 200, `found ${strings.length} Turkish strings`);
  const hits = strings.filter(([, s]) => !ALLOWED_STRINGS.some((re) => re.test(s))).map(([f, s]) => [f, secondPerson(s), s.slice(0, 120)]).filter(([, w]) => w.length);
  assert.deepEqual(hits, []);
});

test("the scan catches the forms it is for and passes ordinary Turkish", () => {
  for (const [bad, word] of [["Uygulama hâlâ BigQuery verinizi okuyor", "verinizi"], ["Siteniz hazır", "Siteniz"], ["İstediğinizde geçin", "İstediğinizde"], ["Bir kaynak bağlayın", "bağlayın"], ["Bağlantıyı kontrol edin", "edin"], ["Tekrar deneyin", "deneyin"], ["Bu sizin için", "sizin"], ["hariç tutun", "tutun"]]) {
    assert.ok(secondPerson(bad).includes(word), bad);
  }
  for (const ok of ["Sunucuda bir sorun oluştu.", "GA4 satın almaları için veri yok", "Mağazanın verisi hazır", "Sütun boş", "İzin verilen tablolar", "yalnızca mobilde", "Ürün kategorileri", "Platformun bildirdiği dönüşüm", "Ücretsiz kargo sınırı", "Yeniden başlatılmalı", "kanalın payı"]) {
    assert.deepEqual(secondPerson(ok), [], ok);
  }
});
