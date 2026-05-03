import { loadLocalEnv } from "./env.js";

loadLocalEnv();

const HOLIDAY_SERVICE_URL = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
const HOLIDAY_SERVICE_KEY = process.env.KOREA_HOLIDAY_SERVICE_KEY || process.env.HOLIDAY_SERVICE_KEY || "";
const holidayCache = new Map();

const FALLBACK_SOLAR_HOLIDAYS = [
  ["01-01", "1월1일"],
  ["03-01", "삼일절"],
  ["05-05", "어린이날"],
  ["06-06", "현충일"],
  ["08-15", "광복절"],
  ["10-03", "개천절"],
  ["10-09", "한글날"],
  ["12-25", "성탄절"]
];

export async function getKoreanHolidays(year) {
  const normalizedYear = normalizeYear(year);
  if (!normalizedYear) {
    return { year, source: "none", configured: Boolean(HOLIDAY_SERVICE_KEY), holidays: [] };
  }

  if (holidayCache.has(normalizedYear)) return holidayCache.get(normalizedYear);

  const result = HOLIDAY_SERVICE_KEY
    ? await fetchOfficialHolidays(normalizedYear).catch((error) => ({
        year: normalizedYear,
        source: "fallback",
        configured: true,
        warning: error.message,
        holidays: buildFallbackHolidays(normalizedYear)
      }))
    : {
        year: normalizedYear,
        source: "fallback",
        configured: false,
        warning: "KOREA_HOLIDAY_SERVICE_KEY is not configured.",
        holidays: buildFallbackHolidays(normalizedYear)
      };

  holidayCache.set(normalizedYear, result);
  return result;
}

async function fetchOfficialHolidays(year) {
  const params = new URLSearchParams({
    solYear: String(year),
    numOfRows: "100",
    pageNo: "1",
    _type: "json"
  });
  const serviceKey = HOLIDAY_SERVICE_KEY.includes("%")
    ? HOLIDAY_SERVICE_KEY
    : encodeURIComponent(HOLIDAY_SERVICE_KEY);
  const url = `${HOLIDAY_SERVICE_URL}?ServiceKey=${serviceKey}&${params}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Holiday API returned ${response.status}`);
  }

  const payload = await response.json();
  const resultCode = payload?.response?.header?.resultCode;
  if (resultCode && resultCode !== "00") {
    throw new Error(payload?.response?.header?.resultMsg || `Holiday API result ${resultCode}`);
  }

  const rawItems = payload?.response?.body?.items?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  const holidays = items
    .map(normalizeHolidayItem)
    .filter((item) => item.date && item.name && item.isHoliday !== false)
    .sort((left, right) => left.date.localeCompare(right.date));

  return {
    year,
    source: "official",
    configured: true,
    holidays
  };
}

function normalizeHolidayItem(item) {
  const locdate = String(item?.locdate ?? "").trim();
  const date = locdate.length === 8
    ? `${locdate.slice(0, 4)}-${locdate.slice(4, 6)}-${locdate.slice(6, 8)}`
    : "";
  const rawHoliday = String(item?.isHoliday ?? "Y").toUpperCase();
  return {
    date,
    name: String(item?.dateName ?? "").trim(),
    isHoliday: rawHoliday === "Y" || rawHoliday === "TRUE" || rawHoliday === "1",
    dateKind: String(item?.dateKind ?? "").trim()
  };
}

function buildFallbackHolidays(year) {
  return FALLBACK_SOLAR_HOLIDAYS.map(([monthDay, name]) => ({
    date: `${year}-${monthDay}`,
    name,
    isHoliday: true,
    dateKind: "fallback"
  }));
}

function normalizeYear(value) {
  const year = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  return year;
}
