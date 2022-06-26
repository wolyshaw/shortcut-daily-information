/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
dayjs.extend(utc)
dayjs.extend(timezone)

dayjs.tz.setDefault("America/New_York")

/** 此处获取的时间不对，需要在fetch事件中获取的才对？？？ */
let datestr = ''

const getSeatchs = (request: Request) => {
  const searchParams = new URL(request.url).searchParams
  return Object.fromEntries(searchParams.entries())
}

export interface Env {
  // Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
  // MY_KV_NAMESPACE: KVNamespace;
  /** KV存储 */
  DAILY_KV: KVNamespace
  /** 新闻获取地址 */
  NEWES_URL: string
  /** 天气获取地址 */
  WEATHUR_URL: string
  /** 天气TOKEN */
  WEATHUR_TOKEN: string
  /** 默认查询参数 */
  INIT_QUERYLIST: string
  //
  // Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
  // MY_DURABLE_OBJECT: DurableObjectNamespace;
  //
  // Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
  // MY_BUCKET: R2Bucket;
}

type NewsResponse = {
  zt: number
  wb: string 
}

/**
 * 获取天气信息，默认按照ip地址获取，也可以通过area设置，海外地区无法获取
 * @param env Env
 * @param request Request
 * @returns Promise<string>
 */
const getWeather = async (env: Env, request: Request):Promise<string> => {
  const { area = '' } = getSeatchs(request)
  const ip = request.headers.get('CF-Connecting-IP') || ''
  if (!ip && !area) return ''
  const WeatherKey = datestr + (area ? area : ip) + 'weather'
  const KVWeather = await env.DAILY_KV.get(WeatherKey)
  if (KVWeather) return KVWeather
  const requestPath = area ? ('/hour24' + area) : ('/ip-to-weather?ip=' + ip + '&need3HourForcast=0&needAlarm=0&needHourData=0&needIndex=0&needMoreDay=0')
  const FetchWeather = await fetch(env.WEATHUR_URL + requestPath, {
    headers: {
      Authorization: env.WEATHUR_TOKEN
    }
  })
  .then(res => res.json())
  .then((res: any) => res.showapi_res_body)
  .then((res: any) => {
    return `天气${res.now.weather}，温度${res.now.temperature}摄氏度，湿度${res.now.sd}，空气质量${res.now.aqiDetail.aqi} ${res.now.aqiDetail.quality}`
  })
  .catch(() => '')
  if (FetchWeather) {
    env.DAILY_KV.put(WeatherKey, FetchWeather)
  }
  return FetchWeather
}

/**
 * 获取当日新闻，默认缓存到KV存储中
 * @param env 
 * @returns Promise<string>
 */
const getNews = async (env: Env, request: Request):Promise<string> => {
  const { NewsNum = '15' } = getSeatchs(request)
  const newsLength = Math.max(+NewsNum, 0)
  const NewsKey = datestr + newsLength + 'news'
  const KVNews = await env.DAILY_KV.get(NewsKey)
  if (KVNews) return KVNews
  const FetchNews = await fetch(env.NEWES_URL)
    .then(res => res.json())
    .then((res: unknown) => {
      const {zt, wb} = res as NewsResponse
      if (zt === 0) {
        const wbs = wb.split('【换行】')
        wbs.length = newsLength
        return wbs.join(' ')
      }
      return ''
    })
    .catch((err: Error) => '')
    if (FetchNews) {
      env.DAILY_KV.put(NewsKey, FetchNews)
    }
    return FetchNews
}

const getCurrentTime = () => {
  return Promise.resolve(`现在是${dayjs().tz("Asia/Shanghai").format('YYYY年MM月DD日 HH时mm分')}`)
}

/** type获取数据方法映射 */
const fetchs: {[key in string]: (env: Env, request: Request) => Promise<string>} = {
  Time: getCurrentTime,
  News: getNews,
  Weather: getWeather,
}

/** 数据前缀 */
const resultsPrefix: {[key in string]: string} = {
  Time: '',
  News: '今日要闻',
  Weather: '今日天气',
}

const getResults = async (env: Env, request: Request): Promise<string[]> => {
  const searchParams = new URL(request.url).searchParams
  const queryList = (searchParams.get('query') || env.INIT_QUERYLIST).split(',')
  const loop = () => Promise.resolve('')
  const results = []
  for (const item of queryList) {
    const FetchItem = fetchs[item] || loop
    const res = await FetchItem(env, request)
    const prefix = resultsPrefix[item] || ''
    if (res) {
      results.push([prefix, res].join(' '))
    }
  }
  return results
}


export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {

    datestr = dayjs().tz("Asia/Shanghai").format('YYYY-MM-DD')
    if (new URL(request.url).pathname !== '/') return new Response('', {status: 404})
    getResults(env, request)
    const results: string[] = await getResults(env, request)
    return new Response(results.join(' '), {
      headers: {
        'Content-type': 'text/plain; charset=utf-8'
      }
    });
  },
};
