/**
 * services/numberWords.js — dollar amounts in words for check printing
 * (ROADMAP-V5 · Phase 4.2). Spanish (PR check convention) and English.
 * Input is integer cents; output like:
 *   es: "CUATROCIENTOS CINCUENTA Y CINCO CON 00/100 DÓLARES"
 *   en: "FOUR HUNDRED FIFTY-FIVE AND 00/100 DOLLARS"
 */

const ES_UNITS = [
  "cero",
  "uno",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciséis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
  "veinte",
  "veintiuno",
  "veintidós",
  "veintitrés",
  "veinticuatro",
  "veinticinco",
  "veintiséis",
  "veintisiete",
  "veintiocho",
  "veintinueve",
];
const ES_TENS = [
  "",
  "",
  "",
  "treinta",
  "cuarenta",
  "cincuenta",
  "sesenta",
  "setenta",
  "ochenta",
  "noventa",
];
const ES_HUNDREDS = [
  "",
  "ciento",
  "doscientos",
  "trescientos",
  "cuatrocientos",
  "quinientos",
  "seiscientos",
  "setecientos",
  "ochocientos",
  "novecientos",
];

function esBelow1000(n) {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const parts = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) parts.push(ES_HUNDREDS[h]);
  if (rest > 0) {
    if (rest < 30) {
      parts.push(ES_UNITS[rest]);
    } else {
      const t = Math.floor(rest / 10);
      const u = rest % 10;
      parts.push(u > 0 ? `${ES_TENS[t]} y ${ES_UNITS[u]}` : ES_TENS[t]);
    }
  }
  return parts.join(" ");
}

function esWhole(n) {
  if (n === 0) return "cero";
  const parts = [];
  const millions = Math.floor(n / 1000000);
  const thousands = Math.floor((n % 1000000) / 1000);
  const rest = n % 1000;
  if (millions > 0) {
    parts.push(
      millions === 1 ? "un millón" : `${esBelow1000(millions)} millones`,
    );
  }
  if (thousands > 0) {
    parts.push(thousands === 1 ? "mil" : `${esBelow1000(thousands)} mil`);
  }
  if (rest > 0) parts.push(esBelow1000(rest));
  return parts.join(" ");
}

const EN_UNITS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const EN_TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

function enBelow1000(n) {
  if (n === 0) return "";
  const parts = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) parts.push(`${EN_UNITS[h]} hundred`);
  if (rest > 0) {
    if (rest < 20) {
      parts.push(EN_UNITS[rest]);
    } else {
      const t = Math.floor(rest / 10);
      const u = rest % 10;
      parts.push(u > 0 ? `${EN_TENS[t]}-${EN_UNITS[u]}` : EN_TENS[t]);
    }
  }
  return parts.join(" ");
}

function enWhole(n) {
  if (n === 0) return "zero";
  const parts = [];
  const millions = Math.floor(n / 1000000);
  const thousands = Math.floor((n % 1000000) / 1000);
  const rest = n % 1000;
  if (millions > 0) parts.push(`${enBelow1000(millions)} million`);
  if (thousands > 0) parts.push(`${enBelow1000(thousands)} thousand`);
  if (rest > 0) parts.push(enBelow1000(rest));
  return parts.join(" ");
}

/**
 * @param {number} cents - integer cents, non-negative
 * @param {"es"|"en"} lang
 * @returns {string} uppercase amount-in-words check line
 */
export function amountInWords(cents, lang = "es") {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("amountInWords: cents must be a non-negative integer");
  }
  const dollars = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  const words =
    lang === "es"
      ? `${esWhole(dollars)} con ${frac}/100 dólares`
      : `${enWhole(dollars)} and ${frac}/100 dollars`;
  return words.toUpperCase();
}
