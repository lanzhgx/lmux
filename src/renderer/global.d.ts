import type { LanniApi } from '../shared/types'

declare global {
  interface Window {
    lanni: LanniApi
  }
}

export {}
