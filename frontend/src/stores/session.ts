import { defineStore } from 'pinia'

import type { Actor, ActorRole } from '@/data/sediment-types'

const ROLE_NAMES: Record<ActorRole, string> = {
  '值班员': '王汛',
  '审核员': '李审',
  '管理员': '站长',
}

export const ROLE_CAN: Record<ActorRole, string> = {
  '值班员': '登记草稿、提交审核',
  '审核员': '审核、人工复核质量结论',
  '管理员': '补录历史缺测字段，兼有值班/审核权限',
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '王汛',
    role: '值班员' as ActorRole,
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    actor(state): Actor {
      return { name: state.operator, role: state.role }
    },
  },
  actions: {
    setRole(role: ActorRole) {
      this.role = role
      this.operator = ROLE_NAMES[role]
    },
    setShift(label: string) {
      this.shiftLabel = label
    },
  },
})
