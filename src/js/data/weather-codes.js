/* WMO weather codes → icon type + labels. */
export const WMO = {
  0: { icon: "clear", en: "Clear sky", fr: "Ciel dégagé" },
  1: { icon: "clear", en: "Mainly clear", fr: "Plutôt dégagé" },
  2: { icon: "partly", en: "Partly cloudy", fr: "Partiellement nuageux" },
  3: { icon: "cloudy", en: "Overcast", fr: "Couvert" },
  45: { icon: "fog", en: "Fog", fr: "Brouillard" },
  48: { icon: "fog", en: "Rime fog", fr: "Brouillard givrant" },
  51: { icon: "rain", en: "Light drizzle", fr: "Bruine légère" },
  53: { icon: "rain", en: "Drizzle", fr: "Bruine" },
  55: { icon: "rain", en: "Heavy drizzle", fr: "Bruine dense" },
  56: { icon: "rain", en: "Freezing drizzle", fr: "Bruine verglaçante" },
  57: { icon: "rain", en: "Freezing drizzle", fr: "Bruine verglaçante" },
  61: { icon: "rain", en: "Light rain", fr: "Pluie légère" },
  63: { icon: "rain", en: "Rain", fr: "Pluie" },
  65: { icon: "rain", en: "Heavy rain", fr: "Pluie forte" },
  66: { icon: "rain", en: "Freezing rain", fr: "Pluie verglaçante" },
  67: { icon: "rain", en: "Freezing rain", fr: "Pluie verglaçante" },
  71: { icon: "snow", en: "Light snow", fr: "Neige légère" },
  73: { icon: "snow", en: "Snow", fr: "Neige" },
  75: { icon: "snow", en: "Heavy snow", fr: "Neige forte" },
  77: { icon: "snow", en: "Snow grains", fr: "Neige en grains" },
  80: { icon: "rain", en: "Light showers", fr: "Averses légères" },
  81: { icon: "rain", en: "Showers", fr: "Averses" },
  82: { icon: "rain", en: "Violent showers", fr: "Averses violentes" },
  85: { icon: "snow", en: "Snow showers", fr: "Averses de neige" },
  86: { icon: "snow", en: "Snow showers", fr: "Averses de neige" },
  95: { icon: "storm", en: "Thunderstorm", fr: "Orage" },
  96: { icon: "storm", en: "Thunderstorm with hail", fr: "Orage avec grêle" },
  99: { icon: "storm", en: "Thunderstorm with hail", fr: "Orage avec grêle" },
};

export function wmo(code) {
  return WMO[code] || WMO[0];
}

export function wxDesc(code, lang) {
  return wmo(code)[lang];
}

/* clear/cloudy icon key, day/night-aware — used to pick the hero gradient */
export function skyKey(code, isDay) {
  const icon = wmo(code).icon;
  if (icon === "clear" || icon === "partly") return isDay ? "clear-day" : "clear-night";
  if (icon === "cloudy") return isDay ? "cloudy-day" : "cloudy-night";
  return icon; // rain / snow / storm / fog
}
