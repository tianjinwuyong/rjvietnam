import axios from 'axios'

const TOKEN_KEY = 'oa_token'
const LANG_KEY = 'oa_lang'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}
export function getLang() {
  return localStorage.getItem(LANG_KEY) || 'zh'
}

// 同源部署：生产由后端托管，开发由 vite 代理 /api → 8080。
const http = axios.create({ baseURL: '', timeout: 30000 })

// 请求：注入令牌 + 语言头（后端据此把 code:1 错误消息三语化）
http.interceptors.request.use((cfg) => {
  const token = getToken()
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  cfg.headers['X-OA-Lang'] = getLang()
  return cfg
})

let unauthorizedHandler = null
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn
}

// 响应：解包统一信封 { code, msg, data }
//   成功 → 直接返回 data；失败 → 抛 Error(msg)；401 → 清令牌并触发回调
http.interceptors.response.use(
  (res) => {
    const body = res.data
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) return body.data
      return Promise.reject(new Error(body.msg || '请求失败'))
    }
    return body
  },
  (err) => {
    const status = err?.response?.status
    const msg = err?.response?.data?.msg || err?.message || '网络错误'
    if (status === 401) {
      setToken('')
      localStorage.removeItem('oa_user')
      if (unauthorizedHandler) unauthorizedHandler()
    }
    return Promise.reject(new Error(msg))
  }
)

export default http
