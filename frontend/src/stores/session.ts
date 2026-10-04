import { defineStore } from 'pinia'

// 补录属于对历史缺测数据的写操作，只有复核岗有权限；值班员的越权补录必须拒绝。
export type Role = 'operator' | 'reviewer'

const ROLE_PROFILE: Record<Role, { label: string; operator: string }> = {
  operator: { label: '值班员（仅采集/送审）', operator: '值班管理员' },
  reviewer: { label: '人工复核岗（可补录/复核）', operator: '复核工程师' },
}

export const PERMISSIONS = {
  backfill: 'sediment:backfill',
  manualReview: 'sediment:manual-review',
} as const

const ROLE_PERMISSIONS: Record<Role, string[]> = {
  operator: [],
  reviewer: [PERMISSIONS.backfill, PERMISSIONS.manualReview],
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    role: 'operator' as Role,
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
  }),
  getters: {
    operator(): string {
      return ROLE_PROFILE[this.role].operator
    },
    roleLabel(): string {
      return ROLE_PROFILE[this.role].label
    },
    canOperate: (state) => state.role.length > 0,
    can(): (permission: string) => boolean {
      return (permission: string) => ROLE_PERMISSIONS[this.role].includes(permission)
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: Role) {
      this.role = role
    },
    toggleRole() {
      this.role = this.role === 'operator' ? 'reviewer' : 'operator'
    },
  },
})
