/** YENRA's verified 2026-11-04 greeting re-expressed as thin UI composition.
 * This is a read-only view: official DSH keeps its Session and Composer.
 */
import { useEffect, useState } from 'react'
import {
  BERLIN_WEATHER_URL, berlinClock, berlinDate, berlinGreeting,
  parseCurrentWeather, weatherDescription,
} from './berlin-welcome'

type Weather = {temp: number; code: number}
type WeatherState = {status: 'loading' | 'ok' | 'unavailable'; weather: Weather | null}

export function YenraWorkWelcome({markUrl}: {markUrl: string}) {
  const [now, setNow] = useState(() => new Date())
  const [meteo, setMeteo] = useState<WeatherState>({status: 'loading', weather: null})

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const load = async () => {
      try {
        const response = await fetch(BERLIN_WEATHER_URL, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(9_000)]), cache: 'no-store',
        })
        if (!response.ok) throw Error('Open-Meteo HTTP ' + response.status)
        const value: unknown = await response.json()
        const weather = parseCurrentWeather(value)
        if (!weather) throw Error('Missing current temperature or condition')
        if (active) setMeteo({status: 'ok', weather})
      } catch {
        if (active) setMeteo({status: 'unavailable', weather: null})
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 15 * 60_000)
    return () => { active = false; controller.abort(); window.clearInterval(timer) }
  }, [])

  const weatherText = meteo.status === 'loading' ? '天气获取中…'
    : meteo.weather === null ? '天气暂不可用'
    : weatherDescription(meteo.weather.code) + ' · ' + meteo.weather.temp.toFixed(1) + '°C'

  return <section className="yenra-native-work-welcome" data-yenra-berlin-welcome
    aria-label="YENRA 主人专属欢迎页">
    <img className="yenra-native-welcome-mark" src={markUrl} width={38} height={38} alt="YENRA 鲸鱼标志" />
    <h1 data-yenra-welcome-greeting>{berlinGreeting(now)}</h1>
    <p className="yenra-native-welcome-subtitle">有什么需要我帮你处理的？</p>
    <p className="yenra-native-welcome-meta" aria-label="柏林当地日期、时间与天气">
      <span>德国 · 柏林</span>
      <span>{berlinDate(now)}</span>
      <time dateTime={now.toISOString()} data-yenra-berlin-clock>{berlinClock(now)}</time>
      <span aria-hidden="true">·</span>
      <span role="status" data-yenra-weather>{weatherText}</span>
    </p>
    {meteo.weather !== null &&
      <a className="yenra-native-welcome-source" href="https://open-meteo.com/"
        target="_blank" rel="noopener noreferrer" title="天气来源：Open-Meteo">Open-Meteo</a>}
  </section>
}
