import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/api'

export interface DesktopSession {
  uin: string
  nickname: string
  ownerUsername?: string
  pid: number | null
  status: 'offline' | 'online' | 'login_failed'
  cookies: string
  createdAt: number
  lastActiveAt: number
  processPath: string
  qqPath?: string
  farmCode?: string
  lastCapturedAt?: number
  farmPids?: number[]
  farmCodes?: { code: string; time: string }[]
  autoLogin?: boolean
  boundAccountId?: string
  boundAccountName?: string
  autoRefreshCode?: boolean
  lastCodeRefreshAt?: number
  lastCodeRefreshOk?: boolean
  lastCodeRefreshError?: string
}

export const useDesktopLoginStore = defineStore('desktop-login', () => {
  const qrsig = ref('')
  const qrcode = ref('')
  const qrStatus = ref<'idle' | 'loading' | 'ready' | 'waiting' | 'success' | 'error'>('idle')
  const qrMessage = ref('')
  const loggedUin = ref('')
  const loggedNickname = ref('')
  const loggedCookies = ref('')
  const polling = ref(false)
  const launching = ref(false)
  const launchResult = ref('')
  const sessions = ref<DesktopSession[]>([])
  const loadingSessions = ref(false)

  function resetQrState() {
    qrsig.value = ''
    qrcode.value = ''
    qrStatus.value = 'idle'
    qrMessage.value = ''
    loggedUin.value = ''
    loggedNickname.value = ''
    loggedCookies.value = ''
  }

  async function fetchQR() {
    qrStatus.value = 'loading'
    qrMessage.value = 'ÕýÔÚÉú³É¶þÎ¬Âë...'
    try {
      const res = await api.post('/api/desktop-login/qrcode', { preset: 'vip' })
      if (res.data.ok) {
        qrsig.value = res.data.data.qrsig
        qrcode.value = res.data.data.qrcode
        qrStatus.value = 'ready'
        qrMessage.value = 'ÇëÊ¹ÓÃÊÖ»ú QQ É¨ÂëµÇÂ¼'
        return true
      } else {
        qrStatus.value = 'error'
        qrMessage.value = res.data.error || '»ñÈ¡¶þÎ¬ÂëÊ§°Ü'
        return false
      }
    } catch (e: any) {
      qrStatus.value = 'error'
      qrMessage.value = 'ÇëÇóÊ§°Ü: ' + (e.response?.data?.error || e.message)
      return false
    }
  }

  async function pollQrStatus() {
    if (!qrsig.value) return
    polling.value = true
    try {
      const res = await api.post('/api/desktop-login/check', { qrsig: qrsig.value })
      if (res.data.ok) {
        const data = res.data.data
        if (data.status === 'OK') {
          qrStatus.value = 'success'
          qrMessage.value = 'É¨Âë³É¹¦£¡'
          loggedUin.value = data.uin || ''
          loggedNickname.value = data.nickname || ''
          loggedCookies.value = JSON.stringify(data.cookies || {})
          polling.value = false
          return { done: true, uin: data.uin, nickname: data.nickname, cookies: data.cookies }
        } else if (data.status === 'Wait') {
          qrStatus.value = 'waiting'
          qrMessage.value = data.msg || 'µÈ´ýÉ¨Âë...'
          polling.value = false
          return { done: false }
        } else {
          qrStatus.value = 'error'
          qrMessage.value = data.msg || 'µÇÂ¼Ê§°Ü'
          polling.value = false
          return { done: false, error: data.msg }
        }
      }
    } catch (e: any) {
      qrStatus.value = 'error'
      qrMessage.value = '¼ì²éÊ§°Ü: ' + (e.response?.data?.error || e.message)
    }
    polling.value = false
    return { done: false }
  }

  async function launchQQ(uin: string, cookies: string, nickname: string, autoLogin = false, qqPath = "") {
    launching.value = true
    launchResult.value = ''
    try {
      const res = await api.post('/api/desktop-login/launch', { uin, cookies, nickname, autoLogin, qqPath }, { timeout: 60000 })
      if (res.data.ok) {
        launchResult.value = 'QQ ÒÑÆô¶¯ (PID: ' + res.data.data.pid + ')'
        await fetchSessions()
        return true
      } else {
        launchResult.value = res.data.error || 'Æô¶¯Ê§°Ü'
        return false
      }
    } catch (e: any) {
      launchResult.value = 'Æô¶¯Ê§°Ü: ' + (e.response?.data?.error || e.message)
      return false
    } finally {
      launching.value = false
    }
  }

  async function stopQQ(uin: string) {
    try {
      await api.post('/api/desktop-login/stop', { uin })
      await fetchSessions()
    } catch (e: any) {
      console.error('Í£Ö¹ QQ Ê§°Ü', e)
    }
  }

  async function fetchSessions() {
    loadingSessions.value = true
    try {
      const res = await api.get('/api/desktop-login/sessions')
      if (res.data.ok) {
        sessions.value = res.data.data.sessions || []
      }
    } catch (e) {
      console.error('»ñÈ¡ sessions Ê§°Ü', e)
    } finally {
      loadingSessions.value = false
    }
  }

  async function deleteSession(uin: string) {
    try {
      await api.delete('/api/desktop-login/sessions', { data: { uin } })
      await fetchSessions()
    } catch (e: any) {
      console.error('É¾³ý session Ê§°Ü', e)
    }
  }

  async function openFarm(uin: string) {
    try {
      const res = await api.post('/api/desktop-login/open-farm', { uin }, { timeout: 60000 })
      if (res.data.ok) {
        const result = res.data.data || { ok: true }
        if (result.code) {
          const session = sessions.value.find(s => s.uin === uin)
          if (session) {
            session.farmCode = result.code
            session.lastCapturedAt = result.capturedAt || Date.now()
            session.farmPids = result.farmPids || []
          }
        }
        return result
      } else {
        console.error('openFarm failed:', res.data.error)
        return null
      }
    } catch (e: any) {
      console.error('openFarm error:', e)
      await fetchSessions()
      return null
    }
  }

  async function toggleAutoLogin(uin: string, enabled: boolean) {
    try {
      await api.post('/api/desktop-login/sessions/auto-login', { uin, enabled })
      await fetchSessions()
    } catch (e: any) {
      console.error('toggle autoLogin failed', e)
    }
  }

  async function bindCodeTarget(uin: string, accountId: string) {
    const res = await api.post('/api/desktop-login/sessions/code-target', { uin, accountId })
    if (res.data.ok && res.data.data?.session) {
      const idx = sessions.value.findIndex(s => s.uin === uin)
      if (idx >= 0) sessions.value[idx] = res.data.data.session
    }
    return res.data
  }

  return {
    qrsig, qrcode, qrStatus, qrMessage,
    loggedUin, loggedNickname, loggedCookies,
    polling, launching, launchResult,
    sessions, loadingSessions,
    resetQrState, fetchQR, pollQrStatus,
    launchQQ, stopQQ, fetchSessions, deleteSession,
    openFarm,
    toggleAutoLogin,
    bindCodeTarget,
  }
})
