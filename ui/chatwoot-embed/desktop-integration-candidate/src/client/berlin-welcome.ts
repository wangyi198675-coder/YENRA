/** YENRA display-only Berlin clock and weather descriptors. No shared runtime. */
export const BERLIN_TIME_ZONE = 'Europe/Berlin'
export const BERLIN_WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m,weather_code&timezone=Europe%2FBerlin'

export function berlinHour(date: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: BERLIN_TIME_ZONE, hour: '2-digit', hourCycle: 'h23',
  }).format(date))
}

export function berlinGreeting(date: Date): string {
  const hour = berlinHour(date)
  if (hour >= 5 && hour < 11) return '早上好，主人'
  if (hour >= 11 && hour < 13) return '中午好，主人'
  if (hour >= 13 && hour < 18) return '下午好，主人'
  return '晚上好，主人'
}

export function berlinClock(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: BERLIN_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date)
}

export function berlinDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BERLIN_TIME_ZONE, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(date)
}

export function weatherDescription(code: number): string {
  if (code === 0) return '晴朗'
  if (code <= 2) return '少云'
  if (code === 3) return '多云'
  if (code <= 48) return '有雾'
  if (code <= 57) return '毛毛雨'
  if (code <= 67) return '下雨'
  if (code <= 77) return '下雪'
  if (code <= 82) return '阵雨'
  if (code <= 86) return '阵雪'
  if (code <= 99) return '雷雨'
  return '天气更新中'
}

export function parseCurrentWeather(value: unknown): {temp: number; code: number} | null {
  if (!value || typeof value !== 'object') return null
  const current = (value as {current?: {temperature_2m?: unknown;weather_code?: unknown}}).current
  if (!current || typeof current.temperature_2m !== 'number' ||
      !Number.isFinite(current.temperature_2m) ||
      typeof current.weather_code !== 'number' || !Number.isInteger(current.weather_code)) return null
  return {temp: current.temperature_2m, code: current.weather_code}
}
