import { cityNames, regionCodes, regionNameOverrides, provinceNames } from './locationData.js'

export { regionCodes } from './locationData.js'

export const provinces = Object.entries(provinceNames).map(([code, name]) => ({
  code,
  name,
  cities: Object.entries(cityNames)
    .filter(([city]) => city.startsWith(code.slice(0, 2)))
    .map(([code, name]) => ({ code, name })),
}))

export type UserLocation = {
  region: string
  province?: string
  city?: string
}

const regions = new Set(regionCodes)

/**
 * `Intl.DisplayNames` 在较老的 Safari / 被裁剪过的内核里不存在。
 * 它在模块顶层执行，直接 new 会让整个 bundle 启动即崩，所以拿不到就退化成只显示代码。
 */
const displayNames = (locale: 'zh-CN' | 'en-US'): Intl.DisplayNames | null => {
  const Ctor = (Intl as unknown as { DisplayNames?: typeof Intl.DisplayNames }).DisplayNames
  if (typeof Ctor !== 'function') {
    return null
  }
  try {
    return new Ctor([locale], { type: 'region' })
  } catch {
    return null
  }
}
const regionNames = {
  'zh-CN': displayNames('zh-CN'),
  'en-US': displayNames('en-US'),
}

export const getRegionName = (code: string, locale: 'zh-CN' | 'en-US'): string => {
  if (!regions.has(code)) {
    return ''
  }
  const override = regionNameOverrides[locale][code]
  if (override) {
    return override
  }
  try {
    return regionNames[locale]?.of(code) ?? code
  } catch {
    return code
  }
}

export const normalizeLocation = (value: unknown): UserLocation | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const location = value as Record<string, unknown>
  const { region, province, city } = location
  if (typeof region !== 'string' || !regions.has(region)) {
    return null
  }
  if (region !== 'CN') {
    return { region }
  }
  if (province === undefined) {
    return city === undefined ? { region } : null
  }
  const selectedProvince = provinces.find((item) => item.code === province)
  if (!selectedProvince) {
    return null
  }
  if (city === undefined) {
    return { region, province: selectedProvince.code }
  }
  const selectedCity = selectedProvince.cities.find((item) => item.code === city)
  return selectedCity ? { region, province: selectedProvince.code, city: selectedCity.code } : null
}
