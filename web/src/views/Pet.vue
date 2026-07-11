<script setup lang="ts">
import { storeToRefs } from "pinia"
import { onMounted, ref, watch } from "vue"
import { useAccountStore } from "@/stores/account"
import { usePetStore } from "@/stores/pet"
import { useToastStore } from "@/stores/toast"

const accountStore = useAccountStore()
const petStore = usePetStore()
const toast = useToastStore()
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { overview, dogs, dogFoods, guardLogs, capitalMode, loading, currentTab, feedLoading } = storeToRefs(petStore)
void dogFoods

const error = ref("")
const qualityColors = {
  "普通": "text-gray-500 bg-gray-100 dark:bg-gray-700",
  "稀有": "text-blue-500 bg-blue-100 dark:bg-blue-900/30",
  "珍品": "text-purple-500 bg-purple-100 dark:bg-purple-900/30",
  "天工": "text-amber-500 bg-amber-100 dark:bg-amber-900/30",
} as Record<string, string>

const TABS = [
  { key: "overview", label: "狗狗总览", desc: "查看与管理守护狗狗", icon: "i-carbon-paw" },
  { key: "food", label: "狗粮管理", desc: "查看狗粮库存与喂食", icon: "i-carbon-basketball" },
  { key: "logs", label: "守护日志", desc: "查看防护日志记录", icon: "i-carbon-notebook" },
  { key: "capital", label: "资本模式", desc: "成熟前放狗守护，收获后收回", icon: "i-carbon-chart-line" },
] as const


function formatGuardTime(ts: number | string): string {
  if (!ts) return ''
  const num = typeof ts === 'string' ? parseInt(ts) : ts
  if (isNaN(num) || num <= 0) return ''
  const d = new Date(num * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function handleDeploy(dogId: number) {
  const id = currentAccountId.value
  if (!id) return
  const result = await petStore.deployDog(id, dogId)
  if (result?.ok) toast.success("上阵成功")
  else toast.error(result?.error || "上阵失败")
}

async function handleRecall(dogId: number) {
  const id = currentAccountId.value
  if (!id) return
  const result = await petStore.recallDog(id, dogId)
  if (result?.ok) toast.success("已收起")
  else toast.error(result?.error || "操作失败")
}

async function handleFeed(foodId: number) {
  const id = currentAccountId.value
  if (!id) return
  try {
    await petStore.feedDog(id, foodId, 1)
    toast.success("喂食成功")
    refreshCurrentTab()
  } catch (e: any) {
    toast.error(e.message || "喂食失败")
  }
}

async function handleSaveCapital() {
  const id = currentAccountId.value
  if (!id) return
  const result = await petStore.saveCapitalMode(id, capitalMode.value)
  if (result?.ok) toast.success("资本模式已保存")
  else toast.error(result?.error || "保存失败")
}

function selectCapitalDog(dogId: number) {
  capitalMode.value = { ...capitalMode.value, selectedDogId: capitalMode.value.selectedDogId === dogId ? null : dogId }
}

async function refreshCurrentTab() {
  error.value = ""
  if (!currentAccountId.value) return
  if (!currentAccount.value?.running) {
    error.value = "当前账号未运行，请先启动账号后再查看宠物。"
    return
  }
  const id = currentAccountId.value
  switch (currentTab.value) {
    case "overview": await petStore.fetchOverview(id); break
    case "food": await petStore.fetchFoodItems(id); break
    case "logs": await petStore.fetchGuardLogs(id); break
    case "capital": await Promise.all([petStore.fetchCapitalMode(id), petStore.fetchDogs(id)]); break
  }
}

watch(currentAccountId, (newId) => { if (newId) { petStore.clear(); refreshCurrentTab() } })
watch(() => currentAccount.value?.running, () => { if (currentAccountId.value) refreshCurrentTab() })
onMounted(() => { if (currentAccountId.value) refreshCurrentTab() })
</script>

<template>
  <div class="h-full flex flex-col p-3 sm:p-4">
    <h1 class="mb-4 text-xl font-bold">宠物</h1>

    <!-- 子选项卡导航 -->
    <div class="mb-4 flex flex-wrap gap-2">
      <button
        v-for="tab in TABS" :key="tab.key"
        class="min-h-[44px] flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors"
        :class="currentTab === tab.key
          ? 'text-white shadow-md'
          : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'"
        :style="currentTab === tab.key ? { backgroundColor: 'var(--theme-primary)' } : {}"
        @click="currentTab = tab.key; refreshCurrentTab()"
      >
        <div :class="[tab.icon, 'text-lg']" />
        <div class="text-left text-sm leading-tight">
          <div>{{ tab.label }}</div>
          <div class="text-xs opacity-70">{{ tab.desc }}</div>
        </div>
      </button>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="mb-4 rounded-xl bg-yellow-50 p-4 text-sm text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
      <div class="flex items-center gap-2">
        <span class="i-carbon-warning text-lg" />
        <span>{{ error }}</span>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="flex-1 overflow-y-auto">

      <!-- ===== 狗狗总览 ===== -->
      <template v-if="currentTab === 'overview'">
        <!-- 顶部概要卡片 -->
        <div v-if="dogs.length > 0" class="mb-4 rounded-xl bg-white p-4 shadow-sm dark:bg-gray-800">
          <div class="flex items-start gap-4">
            <div class="flex-shrink-0">
              <div class="h-16 w-16 overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-700">
                <img :src="overview?.currentDog?.image || dogs[0]?.image" :alt="overview?.currentDog?.name || dogs[0]?.name" class="h-full w-full object-cover">
              </div>
            </div>
            <div class="flex-1">
              <div class="mb-1 flex items-center gap-2">
                <span class="text-lg font-bold">{{ overview?.currentDog?.name || dogs[0]?.name || '未部署' }}</span>
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="qualityColors[(overview?.currentDog?.quality || dogs[0]?.quality || '')] || 'text-gray-500 bg-gray-100'"
                >
                  {{ overview?.currentDog?.quality || dogs[0]?.quality || '-' }}
                </span>
                <span class="rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="overview?.currentDog
                    ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'"
                >
                  {{ overview?.currentDog ? overview.currentDog.statusLabel : '未部署' }}
                </span>
              </div>
              <p class="mb-2 text-sm text-gray-500 dark:text-gray-400">{{ overview?.currentDog?.description || dogs[0]?.description || '' }}</p>
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <div class="text-xs text-gray-400">狗狗数量</div>
                  <div class="font-bold">{{ overview?.dogCount ?? 0 }}</div>
                  <div class="text-xs text-gray-400">已激活 {{ overview?.activeCount ?? 0 }} 只</div>
                </div>
                <div>
                  <div class="text-xs text-gray-400">守护概率</div>
                  <div class="font-bold">{{ overview?.probability ?? 0 }}%</div>
                  <div class="text-xs text-gray-400">当前展示狗狗</div>
                </div>
                <div v-if="overview?.currentDog || (overview?.feedRemainSec ?? 0) > 0">
                  <div class="text-xs text-gray-400">狗粮剩余时间</div>
                  <div class="font-bold">{{ overview?.feedRemainText ?? '无' }}</div>
                  <!-- 狗粮剩余时间进度条 -->
                  <div v-if="overview?.totalFeedSec && overview?.totalFeedSec > 0" class="mt-1.5">
                    <div class="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
                      <div
                        class="h-full rounded-full transition-all duration-500"
                        :style="{
                          width: Math.min(100, Math.max(0, (overview.feedRemainSec / overview.totalFeedSec) * 100)) + '%',
                          backgroundColor: (overview.feedRemainSec / overview.totalFeedSec) > 0.5
                            ? '#22c55e'
                            : (overview.feedRemainSec / overview.totalFeedSec) > 0.25
                              ? '#eab308'
                              : '#ef4444'
                        }"
                      />
                    </div>
                    <div class="mt-0.5 flex justify-between text-[10px] text-gray-400">
                      <span>剩余 {{ overview?.feedRemainText ?? '0' }}</span>
                      <span>共 {{ overview?.totalFeedText ?? '0' }}</span>
                    </div>
                  </div>
                  <div class="text-xs text-gray-400">当前守护可用时长</div>
                </div>
                <div>
                  <div class="text-xs text-gray-400">狗粮折合时间</div>
                  <div class="font-bold">{{ overview?.totalFeedText ?? '无' }}</div>
                  <div class="text-xs text-gray-400">库存 {{ overview?.foodStockCount ?? 0 }} 个</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 加载或空状态 -->
        <div v-if="loading" class="flex items-center justify-center py-12">
          <div class="i-carbon-circle-dash animate-spin text-2xl text-gray-400" />
          <span class="ml-2 text-gray-400">加载中...</span>
        </div>
        <div v-else-if="!dogs.length" class="py-12 text-center text-gray-400">
          暂无狗狗数据
        </div>

        <!-- 狗狗列表 -->
        <div v-else>
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-lg font-bold">狗狗列表</h3>
            <button
              class="rounded-lg px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              @click="refreshCurrentTab()"
            >
              <span class="i-carbon-renew mr-1" /> 刷新
            </button>
          </div>
          <p class="mb-3 text-sm text-gray-400">图中狗狗可单击选择或切换查看</p>
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="dog in dogs" :key="dog.dogId"
              class="rounded-xl bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:bg-gray-800"
            >
              <div class="mb-3 flex items-start gap-3">
                <div class="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-700">
                  <img :src="dog.image" :alt="dog.name" class="h-full w-full object-cover">
                </div>
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-bold">{{ dog.name }}</span>
                    <span
                      class="rounded-full px-1.5 py-0.5 text-xs font-medium"
                      :class="qualityColors[dog.quality] || 'text-gray-500 bg-gray-100'"
                    >
                      {{ dog.quality }}
                    </span>
                  </div>
                  <div class="text-xs text-gray-400">{{ dog.statusLabel }}</div>
                </div>
              </div>
              <p class="mb-3 text-sm text-gray-500 dark:text-gray-400">{{ dog.description }}</p>
              <div class="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <div class="text-gray-400">状态</div>
                  <div class="font-medium">{{ dog.statusLabel }}</div>
                </div>
                <div>
                  <div class="text-gray-400">概率</div>
                  <div class="font-medium">{{ dog.probability }}%</div>
                </div>
                <div>
                  <div class="text-gray-400">品质</div>
                  <div class="font-medium">{{ dog.quality }}</div>
                </div>
              </div>
              <!-- 操作按钮 -->
              <button
                v-if="dog.status === 'active'"
                class="w-full rounded-lg py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                :style="{ backgroundColor: 'var(--theme-primary)' }"
                @click="handleDeploy(dog.dogId)"
              >
                上阵
              </button>
              <button
                v-else-if="dog.status === 'guarding'"
                class="w-full rounded-lg bg-red-500 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                @click="handleRecall(dog.dogId)"
              >
                收起
              </button>
              <div
                v-else
                class="w-full rounded-lg bg-gray-100 py-2 text-center text-sm text-gray-400 dark:bg-gray-700"
              >
                未激活
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== 狗粮管理 ===== -->
      <template v-if="currentTab === 'food'">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-lg font-bold">狗粮库存</h3>
          <div v-if="overview" class="text-xs text-gray-400">
            剩余容量: {{ overview.feedRemainText || '-' }} / 30天
          </div>
        </div>
        <div v-if="loading" class="py-12 text-center text-gray-400">加载中...</div>
        <div v-else-if="!dogFoods.length" class="py-12 text-center text-gray-400">暂无狗粮</div>
        <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="food in dogFoods" :key="food.id"
            class="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm dark:bg-gray-800"
          >
            <div class="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-700">
              <img :src="petStore.getDogFoodImageUrl(food.id)" :alt="food.name" class="h-full w-full object-cover">
            </div>
            <div class="flex-1">
              <div class="font-bold">{{ food.name }}</div>
              <div class="text-xs text-gray-400">{{ food.days }}天狗粮</div>
              <div class="mt-1 text-sm text-gray-500">x{{ food.count }}</div>
            </div>
            <button
              class="rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              :style="{ backgroundColor: 'var(--theme-primary)' }"
              :disabled="food.count <= 0 || feedLoading"
              @click="handleFeed(food.id)"
            >
              <span v-if="feedLoading" class="i-carbon-loading animate-spin mr-1"></span>
              {{ feedLoading ? '喂食中...' : '喂食' }}
            </button>
          </div>
        </div>
      </template>

      <!-- ===== 守护日志 ===== -->
      <template v-if="currentTab === 'logs'">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-lg font-bold">防护日志</h3>
          <button
            class="rounded-lg px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            @click="refreshCurrentTab()"
          >
            <span class="i-carbon-renew mr-1" /> 刷新
          </button>
        </div>
        <div v-if="loading" class="py-12 text-center text-gray-400">加载中...</div>
        <div v-else-if="!guardLogs.length" class="py-12 text-center text-gray-400">暂无防护日志</div>
        <div v-else class="space-y-2">
          <div
            v-for="(log, idx) in guardLogs" :key="idx"
            class="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm dark:bg-gray-800"
          >
            <div class="h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
              <img :src="log.friendAvatar" :alt="log.friendName" class="h-full w-full object-cover">
            </div>
            <div class="flex-1">
              <div class="font-medium">{{ log.friendName }}</div>
              <div class="text-sm text-gray-500 dark:text-gray-400">
                被{{ log.dogName }}咬了{{ log.biteCount }}次，拦截了{{ log.goldIntercepted }}金币
              </div>
            </div>
            <div class="text-right text-xs text-gray-400">
              <div>{{ formatGuardTime(log.timestamp) }}</div>
              <div class="font-medium text-green-500">{{ log.status }}</div>
            </div>
          </div>
        </div>

      </template>

      <!-- ===== 资本模式 ===== -->
      <template v-if="currentTab === 'capital'">
        <h3 class="mb-3 text-lg font-bold">资本模式</h3>
        <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
          开启后，当自己土地的农作物即将成熟时自动上阵选中的狗狗进行守护，收获完成后延迟收回。
        </p>

        <div class="space-y-4 rounded-xl bg-white p-4 shadow-sm dark:bg-gray-800">
          <!-- 启用开关 -->
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium">启用资本模式</div>
              <div class="text-sm text-gray-400">农作物成熟前自动放狗，收获后延迟5秒收狗</div>
            </div>
            <button
              class="relative h-6 w-12 rounded-full transition-colors"
              :class="capitalMode.enabled ? '' : 'bg-gray-300 dark:bg-gray-600'"
              :style="capitalMode.enabled ? { backgroundColor: 'var(--theme-primary)' } : {}"
              @click="capitalMode.enabled = !capitalMode.enabled"
            >
              <div
                class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                :class="capitalMode.enabled ? 'translate-x-6' : 'translate-x-0.5'"
              />
            </button>
          </div>

          <!-- 秒数输入 -->
          <div>
            <div class="mb-1 font-medium">成熟前放狗秒数</div>
            <div class="mb-2 text-sm text-gray-400">当距离农作物成熟时间 ≤ 此秒数时，自动上阵选中的狗狗（范围5-300秒，默认10秒）</div>
            <div class="flex items-center gap-2">
              <input
                v-model.number="capitalMode.secondsBeforeMature"
                type="number"
                min="5"
                max="300"
                class="w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-center text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
              <span class="text-sm text-gray-400">秒</span>
            </div>
          </div>

          <!-- 选择狗狗 -->
          <div>
            <div class="mb-1 font-medium">选择上阵的狗狗</div>
            <div class="mb-2 text-sm text-gray-400">选择一只需要在资本模式下自动上阵的狗狗（单选，点击已选中的可取消）</div>
            <div v-if="!dogs.length" class="py-4 text-center text-gray-400">暂无可用狗狗</div>
            <div v-else class="flex flex-wrap gap-3">
              <div
                v-for="dog in dogs" :key="dog.dogId"
                class="cursor-pointer rounded-xl border-2 p-3 transition-all"
                :class="capitalMode.selectedDogId === dog.dogId
                  ? 'shadow-md'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-600 dark:hover:border-gray-500'"
                :style="capitalMode.selectedDogId === dog.dogId
                  ? { borderColor: 'var(--theme-primary)', backgroundColor: 'var(--theme-primary)10' }
                  : {}"
                @click="selectCapitalDog(dog.dogId)"
              >
                <div class="flex items-center gap-2">
                  <div
                    class="h-5 w-5 rounded-full border-2 flex items-center justify-center"
                    :class="capitalMode.selectedDogId === dog.dogId ? '' : 'border-gray-300 dark:border-gray-500'"
                    :style="capitalMode.selectedDogId === dog.dogId ? { borderColor: 'var(--theme-primary)' } : {}"
                  >
                    <div
                      v-if="capitalMode.selectedDogId === dog.dogId"
                      class="h-2.5 w-2.5 rounded-full"
                      :style="{ backgroundColor: 'var(--theme-primary)' }"
                    />
                  </div>
                  <div class="h-8 w-8 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-700">
                    <img :src="dog.image" :alt="dog.name" class="h-full w-full object-cover">
                  </div>
                  <div>
                    <div class="text-sm font-medium">{{ dog.name }}</div>
                    <div class="text-xs text-gray-400">{{ dog.quality }} · 守护概率 {{ dog.probability }}%</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 保存 -->
          <button
            class="w-full rounded-lg py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            :style="{ backgroundColor: 'var(--theme-primary)' }"
            @click="handleSaveCapital"
          >
            保存资本模式设置
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
