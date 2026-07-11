export interface MenuItem  {

  path: string

  name: string

  label: string

  icon: string

  component: () => Promise<any>

  adminOnly?: boolean

  activityKey?: string

}



export const menuRoutes: MenuItem[] = [

  {

    path: '',

    name: 'dashboard',

    label: '概览',

    icon: 'i-carbon-chart-pie',

    component: () => import('@/views/Dashboard.vue'),

  },

  {

    path: 'personal',

    name: 'personal',

    label: '个人',

    icon: 'i-carbon-user',

    component: () => import('@/views/Personal.vue'),

  },

  {

    path: 'mall',

    name: 'mall',

    label: '道具商城',

    icon: 'i-carbon-shopping-cart',

    component: () => import('@/views/Mall.vue'),

  },

  {

    path: 'activity',

    name: 'activity',

    label: '荷风游记',

    icon: 'i-carbon-events',

    component: () => import('@/views/Activity.vue'),


    activityKey: 'heFengEnabled',
  },

  {

    path: 'qingniang',

    name: 'qingniang',

    label: '青酿换万金',

    icon: 'i-carbon-crop-growth',

    component: () => import('@/views/QingniangActivity.vue'),


    activityKey: 'qingNiangEnabled',
  },

  {
    path: 'pet',
    name: 'pet',
    label: '\u5ba0\u7269',
    icon: 'i-fas-paw',
    component: () => import('@/views/Pet.vue'),
  },
  {

    path: 'friends',

    name: 'friends',

    label: '好友',

    icon: 'i-carbon-user-multiple',

    component: () => import('@/views/Friends.vue'),

  },

  {

    path: 'analytics',

    name: 'analytics',

    label: '分析',

    icon: 'i-carbon-analytics',

    component: () => import('@/views/Analytics.vue'),

  },

  {

    path: 'settings',

    name: 'Settings',

    label: '设置',

    icon: 'i-carbon-settings',

    component: () => import('@/views/Settings.vue'),

  },

  {

    path: 'desktop-login',

    name: 'desktop-login',

    label: '桌面登录',

    icon: 'i-carbon-qr-code',

    component: () => import('@/views/DesktopLogin.vue'),

    adminOnly: true,

  },

  {

    path: 'admin',

    name: 'admin',

    label: '后台',

    icon: 'i-carbon-settings-adjust',

    component: () => import('@/views/AdminPanel.vue'),

    adminOnly: true,

  },

]

