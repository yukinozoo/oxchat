import clsx from 'clsx'
import { useRef, useState, type ChangeEvent, type CSSProperties, type ReactElement } from 'react'
import {
  IconCheckOutline16,
  IconDarkOutline16,
  IconEditOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconPhotosOutline20,
} from '../base/icons.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  setBgImage,
  setBgImageBlur,
  setBgImageOpacity,
  setThemeAccent,
  setThemeBackground,
  setThemePreference,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { readBackgroundImage } from '../../utils/image.js'
import { showToast } from '../base/toastState.js'
import { ColorPickerDialog } from './ColorPickerDialog.js'
import styles from './Appearance.module.css'

/** 主题色预设：淡紫 / 蓝 / 青 / 绿 / 粉 */
const ACCENTS: { hex: string; label: TranslationKey }[] = [
  { hex: '#7c5cff', label: 'themeAccentPurple' },
  { hex: '#2f6bff', label: 'themeAccentBlue' },
  { hex: '#0f93b8', label: 'themeAccentTeal' },
  { hex: '#12a468', label: 'themeAccentGreen' },
  { hex: '#ff2d84', label: 'themeAccentPink' },
]

/** 背景色预设：都是很浅的一层，保证正文对比度 */
const BACKGROUNDS: { hex: string; label: TranslationKey }[] = [
  { hex: '#faf9ff', label: 'themeBgMist' },
  { hex: '#f2fbf6', label: 'themeBgMint' },
  { hex: '#fffbf0', label: 'themeBgCream' },
  { hex: '#f2f9ff', label: 'themeBgIce' },
  { hex: '#fff5f7', label: 'themeBgSakura' },
  { hex: '#fff7f2', label: 'themeBgPeach' },
]

const MODES: { value: ThemePreference; label: TranslationKey; icon: ReactElement }[] = [
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
  { value: 'light', label: 'avatarMenuSettingsDialogThemeSelectLightOption', icon: <IconLightOutline16 /> },
  { value: 'dark', label: 'avatarMenuSettingsDialogThemeSelectDarkOption', icon: <IconDarkOutline16 /> },
]

/** 主题页：深浅模式、主题色、背景色与背景图片 */
export const ThemeSettings = () => {
  const t = useTranslate()
  const preference = useSettings((state) => state.themePreference)
  const accent = useSettings((state) => state.themeAccent)
  const background = useSettings((state) => state.themeBackground)
  const bgImage = useSettings((state) => state.bgImage)
  const opacity = useSettings((state) => state.bgImageOpacity)
  const blur = useSettings((state) => state.bgImageBlur)
  const fileRef = useRef<HTMLInputElement>(null)
  const [picking, setPicking] = useState<'accent' | 'background' | null>(null)

  const accentPreset = ACCENTS.find((item) => item.hex === accent)
  const backgroundPreset = BACKGROUNDS.find((item) => item.hex === background)
  const accentLabel = accentPreset ? t(accentPreset.label) : t('themeColorCustom')
  const backgroundLabel = backgroundPreset ? t(backgroundPreset.label) : t('themeColorCustom')
  const opacityFill = ((opacity - 10) / 90) * 100

  const chooseImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    try {
      const dataUrl = await readBackgroundImage(file)
      if (dataUrl.length > 3_000_000) {
        showToast(t('themeBgImageTooLarge'))
        return
      }
      setBgImage(dataUrl)
    } catch {
      showToast(t('themeBgImageFailed'))
    }
  }

  return (
    <div className={styles.page}>
      <div>
        <div className={styles.groupTitle}>{t('themeAppearance')}</div>
        <div className={styles.card}>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>{t('themeMode')}</div>
            <div className={styles.segmented} role="radiogroup" aria-label={t('themeMode')}>
              {MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  role="radio"
                  aria-checked={preference === mode.value}
                  className={clsx(styles.segment, preference === mode.value && styles.segmentActive)}
                  onClick={() => setThemePreference(mode.value)}
                >
                  <span className={styles.segmentIcon}>{mode.icon}</span>
                  <span>{t(mode.label)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>{t('themeAccent')}</span>
              <span className={styles.sectionValue}>{accentLabel}</span>
            </div>
            <div className={styles.swatches}>
              {ACCENTS.map((item) => (
                <button
                  key={item.hex}
                  type="button"
                  className={clsx(styles.swatch, accent === item.hex && styles.swatchSelected)}
                  style={{ backgroundColor: item.hex }}
                  aria-label={t(item.label)}
                  aria-pressed={accent === item.hex}
                  onClick={() => setThemeAccent(item.hex)}
                >
                  {accent === item.hex ? (
                    <span className={styles.swatchCheck}>
                      <IconCheckOutline16 />
                    </span>
                  ) : null}
                </button>
              ))}
              <button
                type="button"
                className={clsx(
                  styles.swatch,
                  styles.swatchCustom,
                  accent !== '' &&
                    !ACCENTS.some((item) => item.hex === accent) &&
                    styles.swatchCustomSelected
                )}
                style={
                  accent && !ACCENTS.some((item) => item.hex === accent)
                    ? { backgroundColor: accent }
                    : undefined
                }
                aria-label={t('themeColorCustom')}
                onClick={() => setPicking('accent')}
              >
                {accent && !ACCENTS.some((item) => item.hex === accent) ? (
                  <span className={styles.swatchCheck}>
                    <IconCheckOutline16 />
                  </span>
                ) : (
                  <IconEditOutline16 />
                )}
              </button>
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>{t('themeBackground')}</span>
              <span className={styles.sectionValue}>{backgroundLabel}</span>
            </div>
            <div className={styles.swatches}>
              {BACKGROUNDS.map((item) => (
                <button
                  key={item.hex}
                  type="button"
                  className={clsx(
                    styles.swatch,
                    background === item.hex && styles.swatchSelected
                  )}
                  style={{ backgroundColor: item.hex }}
                  aria-label={t(item.label)}
                  aria-pressed={background === item.hex}
                  onClick={() => setThemeBackground(item.hex)}
                >
                  {background === item.hex ? (
                    <span className={styles.swatchCheck} style={{ color: '#111827' }}>
                      <IconCheckOutline16 />
                    </span>
                  ) : null}
                </button>
              ))}
              <button
                type="button"
                className={clsx(
                  styles.swatch,
                  styles.swatchCustom,
                  background !== '' &&
                    !BACKGROUNDS.some((item) => item.hex === background) &&
                    styles.swatchCustomSelected
                )}
                style={
                  background && !BACKGROUNDS.some((item) => item.hex === background)
                    ? { backgroundColor: background }
                    : undefined
                }
                aria-label={t('themeColorCustom')}
                onClick={() => setPicking('background')}
              >
                {background && !BACKGROUNDS.some((item) => item.hex === background) ? (
                  <span className={styles.swatchCheck} style={{ color: '#111827' }}>
                    <IconCheckOutline16 />
                  </span>
                ) : (
                  <IconEditOutline16 />
                )}
              </button>
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>{t('themeBgImage')}</div>
            {bgImage ? (
              <>
                <div
                  className={styles.imagePreview}
                  style={{ backgroundImage: `url("${bgImage}")` }}
                />
                <div className={styles.imagePreviewActions}>
                  <button
                    type="button"
                    className={styles.imageAction}
                    onClick={() => fileRef.current?.click()}
                  >
                    {t('themeBgImageReplace')}
                  </button>
                  <button
                    type="button"
                    className={clsx(styles.imageAction, styles.imageActionDanger)}
                    onClick={() => setBgImage('')}
                  >
                    {t('themeBgImageRemove')}
                  </button>
                </div>
                <div className={styles.row}>
                  <span className={styles.label}>{t('themeBgImageOpacity')}</span>
                  <span className={styles.value}>{opacity}%</span>
                </div>
                <input
                  type="range"
                  className={styles.range}
                  style={{ '--fill': `${opacityFill}%` } as CSSProperties}
                  aria-label={t('themeBgImageOpacity')}
                  min={10}
                  max={100}
                  step={5}
                  value={opacity}
                  onChange={(event) => setBgImageOpacity(Number(event.target.value))}
                />
                <div className={styles.row}>
                  <span className={styles.label}>{t('themeBgImageBlur')}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={blur}
                    aria-label={t('themeBgImageBlur')}
                    className={clsx(styles.switch, blur && styles.switchOn)}
                    onClick={() => setBgImageBlur(!blur)}
                  >
                    <span className={styles.switchKnob} />
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                className={styles.imagePicker}
                onClick={() => fileRef.current?.click()}
              >
                <IconPhotosOutline20 />
                {t('themeBgImageChoose')}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => void chooseImage(event)}
            />
          </div>
        </div>
      </div>

      {picking ? (
        <ColorPickerDialog
          value={picking === 'accent' ? accent : background}
          initial={
            (picking === 'accent' ? accent : background) || (picking === 'accent' ? '#7c5cff' : '#faf9ff')
          }
          onPick={(color) => (picking === 'accent' ? setThemeAccent(color) : setThemeBackground(color))}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </div>
  )
}
