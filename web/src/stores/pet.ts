import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/api'

export interface DogFoodItem {
  id: number
  count: number
  name: string
  days: number
}

export interface DogTypeInfo {
  id: number
  name: string
  growTime: number
  qualityLevel: number
  field4: number
  field7: number
}

export interface DogItem {
  dogId: number
  name: string
  quality: string
  qualityLabel: string
  probability: number
  status: 'inactive' | 'active' | 'guarding'
  statusLabel: string
  description: string
  image: string
  skillName?: string
  skillDesc?: string
}

export interface DogStatusData {
  gid: number
  isOwn: boolean
  fed: boolean
  dogTypeId: number
  dogName: string
  foodRemainSec: number
  foodTotalCap: number
  statusText: string
  qualityLevel: number
  qualityName: string
  qualityColor: string
  guardRate: number
  description: string
  dogTypes: DogTypeInfo[]
  activeFoodItems?: any[]
  activeFoodSummary?: string
  note?: string
  friendGid?: number
}

export interface GuardLogEntry {
  friendName: string
  friendAvatar: string
  dogName: string
  biteCount: number
  goldIntercepted: number
  timestamp: string
  status: string
}

export interface CapitalModeConfig {
  enabled: boolean
  secondsBeforeMature: number
  selectedDogId: number | null
}

export interface DoghouseItem {
  id: number
  count: number
  name: string
}

export interface PetShopGoods {
  id: number
  bought_num: number
  price: number
  limit_count: number
  unlocked: boolean
  item_id: number
  item_count: number
  [key: string]: any
}

export interface DogOverview {
  currentDog: DogItem | null
  dogCount: number
  activeCount: number
  probability: number
  feedRemainSec: number
  feedRemainText: string
  totalFeedSec: number
  totalFeedText: string
  foodStockCount: number
}

export const DOG_FOOD_NAMES: Record<number, string> = {
  90004: '1天狗粮',
  90005: '3天狗粮',
  90006: '5天狗粮',
}

export const DOG_FOOD_DAYS: Record<number, number> = {
  90004: 1,
  90005: 3,
  90006: 5,
}

export const DOG_QUALITY_NAMES: Record<number, string> = {
  100: '普通',
  200: '稀有',
  300: '珍品',
  500: '天工',
}

export const DOG_QUALITY_COLORS: Record<number, string> = {
  100: '#9ca3af',
  200: '#60a5fa',
  300: '#f59e0b',
  500: '#a855f7',
}

export const DOG_GUARD_RATES: Record<number, number> = {
  100: 0.30,
  200: 0.55,
  300: 0.75,
  500: 0.92,
}

export const DOG_DEFAULT_QUALITY: Record<number, number> = {
  90001: 200, 90002: 100, 90003: 300, 90011: 300, 90021: 500,
}

export const DOG_DESCRIPTIONS: Record<number, string> = {
  90001: '忠诚可靠的农家伙伴，守护农田的好帮手',
  90002: '聪明机警的牧羊能手，反应迅速',
  90003: '活泼机灵的小卫士，警觉性极高',
  90011: '短小精悍，嗅觉灵敏，擅长发现异常',
  90021: '勇猛忠诚的守护者，威震四方',
}

export const usePetStore = defineStore('pet', () => {
  const currentTab = ref<'overview' | 'food' | 'logs' | 'rewards' | 'capital' | 'shop'>('overview')
  const loading = ref(false)
  const dogStatus = ref<DogStatusData | null>(null)
  const dogFoods = ref<DogFoodItem[]>([])
  const doghouses = ref<DoghouseItem[]>([])
  const shopItems = ref<PetShopGoods[]>([])
  const shopLoading = ref(false)
  const feedLoading = ref(false)
  const doghouseLoading = ref(false)
  const overview = ref<DogOverview | null>(null)
  const dogs = ref<DogItem[]>([])
  const guardLogs = ref<GuardLogEntry[]>([])
  const guardLogTotal = ref(0)
  const capitalMode = ref<CapitalModeConfig>({ enabled: false, secondsBeforeMature: 10, selectedDogId: null })

  const hasActiveDog = computed(() => !!(dogStatus.value && dogStatus.value.fed))
  const availableDogFoods = computed(() => dogFoods.value.filter(f => f.count > 0))

  function getQualityName(level: number): string { return DOG_QUALITY_NAMES[level] || '普通' }
  function getQualityColor(level: number): string { return DOG_QUALITY_COLORS[level] || '#9ca3af' }
  function getGuardRate(level: number): number { return DOG_GUARD_RATES[level] || 0.3 }

  function formatRemainTime(seconds: number): string {
    if (seconds == null || seconds <= 0) return '已过期'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (h > 24) { const d = Math.floor(h / 24); const rh = h % 24; return d + '天' + (rh > 0 ? rh + '小时' : '') }
    return (h > 0 ? h + '小时' : '') + (m > 0 ? m + '分钟' : '')
  }

  function getDogImageUrl(id: number): string {
    const m: Record<number, string> = {
      90001: '/game-config/seed_images_named/90001_田园犬_Item_4_1.png',
      90002: '/game-config/seed_images_named/90002_牧羊犬_Item_4_3.png',
      90003: '/game-config/seed_images_named/90003_斑点狗_Item_4_4.png',
      90011: '/game-config/seed_images_named/90011_柯基_Item_8_11.png',
      90021: '/game-config/seed_images_named/90021_护主犬_Item_8_21.png',
    }
    return m[id] || ''
  }

  function getDogFoodImageUrl(id: number): string {
    const m: Record<number, string> = {
      90004: '/game-config/seed_images_named/90004_1天狗粮_dogFood1.png',
      90005: '/game-config/seed_images_named/90005_3天狗粮_dogFood2.png',
      90006: '/game-config/seed_images_named/90006_5天狗粮_dogFood3.png',
    }
    return m[id] || ''
  }

  function describeDog(id: number): string { return DOG_DESCRIPTIONS[id] || '' }

  function clear() {
    overview.value = null; dogs.value = []; guardLogs.value = []
    guardLogTotal.value = 0; shopItems.value = []; dogStatus.value = null
  }

  // ============ 核心：从 /api/pet/status 获取完整狗狗数据 ============
  async function fetchPetStatus(accountId: string, friendGid?: string | number) {
    try {
      const params: Record<string, any> = {}
      if (friendGid) params.friendGid = String(friendGid)
      const res = await api.get('/api/pet/status', {
        headers: { 'x-account-id': accountId }, params,
      })
      if (res.data?.ok) { dogStatus.value = res.data.data }
    } catch { /* ignore */ }
  }

  // 从 dogTypes 构建 dogs + overview（数据源与原始工作代码一致）
  function buildDogsFromStatus(d: DogStatusData): DogItem[] {
    const dtList: DogTypeInfo[] = d.dogTypes || []
    const activeDogId = Number(d.dogTypeId)
    return dtList.map((dt: DogTypeInfo) => {
      const qLevel = DOG_DEFAULT_QUALITY[dt.id] || 100
      const guardRate = DOG_GUARD_RATES[qLevel] || 0.3
      const isActive = dt.id === activeDogId
      return {
        dogId: dt.id,
        name: dt.name || '未知#' + dt.id,
        quality: DOG_QUALITY_NAMES[qLevel] || '普通',
        qualityLabel: DOG_QUALITY_NAMES[qLevel] || '普通',
        probability: Math.round(guardRate * 100),
        status: isActive ? 'guarding' : (dt.field7 > 0 ? 'active' : 'inactive'),
        statusLabel: isActive ? '守护中' : (dt.field7 > 0 ? '已激活' : '未激活'),
        description: DOG_DESCRIPTIONS[dt.id] || (dt.name + '，忠实的小伙伴'),
        image: getDogImageUrl(dt.id),
        skillName: dt.id === 90021 ? '同气连枝' : '',
        skillDesc: dt.id === 90021 ? '概率掉落金色礼包' : '',
      }
    })
  }

  function buildOverviewFromDogs(allDogs: DogItem[], d: DogStatusData): DogOverview {
    const activeDog = allDogs.find(dog => dog.status === 'guarding')
    return {
      currentDog: activeDog || null,
      dogCount: allDogs.length,
      activeCount: allDogs.filter(x => x.status !== 'inactive').length,
      probability: activeDog ? activeDog.probability : 0,
      feedRemainSec: d.foodRemainSec || 0,
      feedRemainText: formatRemainTime(d.foodRemainSec || 0),
      totalFeedSec: d.foodTotalCap || 0,
      totalFeedText: formatRemainTime(d.foodTotalCap || 0),
      foodStockCount: dogFoods.value.reduce((sum, f) => sum + f.count, 0),
    }
  }

  async function fetchOverview(accountId: string) {
    if (!accountId) return
    loading.value = true
    try {
      // 直接调用 API 避免 fetchPetStatus 的 loading 管理冲突
      const res = await api.get('/api/pet/status', {
        headers: { 'x-account-id': accountId },
      })
      const d: DogStatusData | null = res.data?.ok ? res.data.data : null
      if (d) {
        dogStatus.value = d
        if (d.dogTypes && d.dogTypes.length > 0) {
          const allDogs = buildDogsFromStatus(d)
          dogs.value = allDogs
          overview.value = buildOverviewFromDogs(allDogs, d)
        } else if (d.dogTypeId) {
          // 后端没有返回 dogTypes 但返回了当前狗信息，从单条构建
          const qLevel = DOG_DEFAULT_QUALITY[d.dogTypeId] || 100
          const guardRate = DOG_GUARD_RATES[qLevel] || 0.3
          const singleDog: DogItem = {
            dogId: d.dogTypeId,
            name: d.dogName || '未知#' + d.dogTypeId,
            quality: DOG_QUALITY_NAMES[qLevel] || '普通',
            qualityLabel: DOG_QUALITY_NAMES[qLevel] || '普通',
            probability: Math.round(guardRate * 100),
            status: d.fed ? 'guarding' : 'active',
            statusLabel: d.fed ? '守护中' : '已激活',
            description: DOG_DESCRIPTIONS[d.dogTypeId] || '',
            image: getDogImageUrl(d.dogTypeId),
            skillName: d.dogTypeId === 90021 ? '同气连枝' : '',
            skillDesc: d.dogTypeId === 90021 ? '概率掉落金色礼包' : '',
          }
          dogs.value = [singleDog]
          overview.value = {
            currentDog: singleDog,
            dogCount: 1,
            activeCount: 1,
            probability: singleDog.probability,
            feedRemainSec: d.foodRemainSec || 0,
            feedRemainText: formatRemainTime(d.foodRemainSec || 0),
            totalFeedSec: d.foodTotalCap || 0,
            totalFeedText: formatRemainTime(d.foodTotalCap || 0),
            foodStockCount: dogFoods.value.reduce((sum, f) => sum + f.count, 0),
          }
          console.warn('[pet] fetchOverview: built from single dog (no dogTypes)', d)
        } else {
          dogs.value = []
          overview.value = null
          console.warn('[pet] fetchOverview: no dog data at all', d)
        }
      } else {
        dogs.value = []
        overview.value = null
      }
    } catch (e) {
      console.error('[pet] fetchOverview error:', e)
    } finally {
      loading.value = false
    }
  }

  async function fetchDogs(accountId: string) {
    try {
      await fetchPetStatus(accountId)
      const d = dogStatus.value
      if (d && d.dogTypes && d.dogTypes.length > 0) {
        dogs.value = buildDogsFromStatus(d)
      }
    } catch { /* ignore */ }
  }

  async function deployDog(accountId: string, dogId: number) {
    try {
      const res = await api.post('/api/pet/deploy', { dogTypeId: dogId }, { headers: { 'x-account-id': accountId } })
      if (res.data?.ok) { await fetchOverview(accountId) }
      return res.data
    } catch { return { ok: false, error: '上阵失败' } }
  }

  async function recallDog(accountId: string, dogId: number) {
    try {
      const res = await api.post('/api/pet/recall', { dogId }, { headers: { 'x-account-id': accountId } })
      if (res.data?.ok) { await fetchOverview(accountId) }
      return res.data
    } catch { return { ok: false, error: '收起失败' } }
  }

  async function fetchFoodItems(accountId: string) {
    try {
      const res = await api.get('/api/pet/food-list', { headers: { 'x-account-id': accountId } }).catch(() => null)
      if (res?.data?.ok && res.data.data?.foods?.length) {
        dogFoods.value = res.data.data.foods.map((f: any) => ({
          id: Number(f.food_type_id || 0),
          count: Number(f.count || 0),
          name: f.name || DOG_FOOD_NAMES[Number(f.food_type_id)] || '狗粮 #' + Number(f.food_type_id),
          days: DOG_FOOD_DAYS[Number(f.food_type_id)] || 0,
        }))
        return
      }
      // 回退到背包数据
      const bagRes = await api.get('/api/bag', { headers: { 'x-account-id': accountId } }).catch(() => null)
      if (bagRes?.data?.ok && bagRes.data.data?.items) {
        const items: Array<{ id: number; count: number; name: string }> = bagRes.data.data.items.map((i: any) => ({
          id: Number(i.id) || 0, count: Number(i.count) || 0, name: String(i.name || ''),
        }))
        dogFoods.value = items.filter(i => [90004, 90005, 90006].includes(i.id)).map(i => ({
          id: i.id, count: i.count,
          name: DOG_FOOD_NAMES[i.id] || '狗粮 #' + i.id,
          days: DOG_FOOD_DAYS[i.id] || 0,
        }))
      }
    } catch { /* ignore */ }
  }

    async function fetchGuardLogs(accountId: string) {
    loading.value = true
    try {
      const res = await api.get('/api/pet/guard-logs', {
        headers: { 'x-account-id': accountId },
        params: { page: 0, pageSize: 100 },
      })
      if (res.data?.ok) {
        const data = res.data.data
        guardLogs.value = (data?.items || []).map((item: any) => ({
          friendName: item.friend_name || '未知',
          friendAvatar: item.friend_avatar || '',
          dogName: item.dog_name || '',
          biteCount: Number(item.bite_count || 0),
          goldIntercepted: Number(item.gold_intercepted || 0),
          timestamp: item.timestamp || '',
          status: item.success !== false ? '成功' : '失败',
        }))
        guardLogTotal.value = Number(data?.total || 0)
      }
    } catch { /* ignore */ }
    finally { loading.value = false }
  }
  async function fetchRewards(accountId: string) {
    try {
      const res = await api.get('/api/pet/rewards', { headers: { 'x-account-id': accountId } })
      if (res.data?.ok) return res.data.data
    } catch { /* ignore */ }
    return { has_huzhu_dog: false, can_claim: false, rewards: [] }
  }

  async function claimRewards(accountId: string) {
    try {
      const res = await api.post('/api/pet/rewards/claim', {}, { headers: { 'x-account-id': accountId } })
      return res.data
    } catch { return { ok: false, error: '领取失败' } }
  }

  async function fetchCapitalMode(accountId: string) {
    try {
      const res = await api.get('/api/pet/capital-mode', { headers: { 'x-account-id': accountId } })
      if (res.data?.ok) {
        const data = res.data.data
        capitalMode.value = {
          enabled: !!data.config?.enabled,
          secondsBeforeMature: Number(data.config?.seconds_before_mature || data.config?.secondsBeforeMature || 10),
          selectedDogId: data.config?.selected_dog_id || data.config?.selectedDogId || null,
        }
      }
    } catch { /* ignore */ }
  }

  async function saveCapitalMode(accountId: string, config: CapitalModeConfig) {
    try {
      const res = await api.post('/api/pet/capital-mode/save', config, { headers: { 'x-account-id': accountId } })
      if (res.data?.ok) { capitalMode.value = config }
      return res.data
    } catch { return { ok: false, error: '保存失败' } }
  }

  async function feedDog(accountId: string, itemId: number, count = 1) {
    feedLoading.value = true
    try {
      const res = await api.post('/api/pet/feed', { itemId, count }, { headers: { 'x-account-id': accountId } })
      if (res.data?.ok) { await fetchPetStatus(accountId); return res.data.data }
      throw new Error(res.data?.error || '喂食失败')
    } catch (e: any) {
      if (e.response?.data?.error) throw new Error(e.response.data.error)
      if (e.message) throw e
      throw new Error('喂食失败')
    } finally { feedLoading.value = false }
  }

  async function changeDoghouse(accountId: string, itemId: number) {
    doghouseLoading.value = true
    try {
      const res = await api.post('/api/pet/doghouse', { itemId }, { headers: { 'x-account-id': accountId } })
      if (res.data?.ok) { await fetchPetStatus(accountId); return res.data.data }
      throw new Error(res.data?.error || '更换狗屋失败')
    } finally { doghouseLoading.value = false }
  }

  async function buyPetShopGoods(accountId: string, goodsId: number, count = 1, price = 0) {
    const res = await api.post('/api/pet/shop/buy', { goodsId, count, price }, { headers: { 'x-account-id': accountId } })
    if (res.data?.ok) { await fetchPetShop(accountId); return res.data.data }
    throw new Error(res.data?.error || '购买失败')
  }

  async function fetchPetShop(accountId: string) {
    shopLoading.value = true
    try {
      const res = await api.get('/api/pet/shop', { headers: { 'x-account-id': accountId } })
      if (res.data?.ok) { shopItems.value = res.data.data || [] }
    } catch { /* ignore */ }
    finally { shopLoading.value = false }
  }

  function syncFromBag(items: Array<{ id: number; count: number; name?: string }>) {
    dogFoods.value = items.filter(item => [90004, 90005, 90006].includes(item.id)).map(item => ({
      id: item.id, count: item.count, name: DOG_FOOD_NAMES[item.id] || '狗粮 #' + item.id,
      days: DOG_FOOD_DAYS[item.id] || 0,
    }))
    doghouses.value = items.filter(item => item.id >= 205001 && item.id < 207000).map(item => ({
      id: item.id, count: item.count, name: item.name || '狗屋 #' + item.id,
    }))
  }

  async function refreshCurrentTab(accountId: string) {
    switch (currentTab.value) {
      case 'overview': await fetchOverview(accountId); break
      case 'food': await Promise.all([fetchFoodItems(accountId), fetchPetStatus(accountId)]); break
      case 'logs': await fetchGuardLogs(accountId); break
      case 'rewards': await fetchOverview(accountId); break
      case 'capital': await Promise.all([fetchCapitalMode(accountId), fetchDogs(accountId)]); break
      case 'shop': await fetchPetShop(accountId); break
    }
  }

  return {
    currentTab, loading, dogStatus, dogFoods, doghouses,
    shopItems, shopLoading, feedLoading, doghouseLoading,
    overview, dogs, guardLogs, guardLogTotal, capitalMode,
    hasActiveDog, availableDogFoods,
    fetchPetStatus, fetchPetShop, fetchOverview, fetchDogs,
    deployDog, recallDog, fetchFoodItems,
    fetchGuardLogs, fetchRewards, claimRewards,
    fetchCapitalMode, saveCapitalMode,
    feedDog, changeDoghouse, buyPetShopGoods, syncFromBag,
    refreshCurrentTab, clear,
    getQualityName, getQualityColor, getGuardRate,
    formatRemainTime, getDogImageUrl, getDogFoodImageUrl, describeDog,
  }
})
