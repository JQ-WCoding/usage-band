import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, RenderInput, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Usage } from '../types'

const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, null)

const BAR_CELLS = 10
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const LIMITS: Record<string, { label: string; color: Color }> = {
  five_hour: { label: '5H', color: 'permission' },
  seven_day: { label: '7D', color: 'merged' },
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type Segment = {
  label: string
  labelColor: Color
  percent?: number
  detail?: string
  reset?: { countdown: string; at: string }
}

const pad = (n: number) => String(n).padStart(2, '0')

const dayIndex = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY

export const fmtTokens = (n: number) =>
  n >= 999_500 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

export const fmtCountdown = (resetMs: number, now: number) => {
  const left = resetMs - now
  if (left <= 0) return 'now'
  const minutes = Math.ceil(left / MINUTE)
  if (minutes < 60) return `${minutes}m`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h${pad(minutes % 60)}m`
  return `${Math.floor(minutes / (24 * 60))}d${pad(Math.floor((minutes % (24 * 60)) / 60))}h`
}

export const fmtResetAt = (resetMs: number, now: number) => {
  const d = new Date(resetMs)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const days = dayIndex(d) - dayIndex(new Date(now))
  if (days === 0) return time
  if (days > 0 && days < 7) return `${WEEKDAYS[d.getDay()]} ${time}`
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${time}`
}

export const bar = (percent: number) => {
  const p = Math.min(100, Math.max(0, percent))
  const filled = p > 0 ? Math.max(1, Math.round((p / 100) * BAR_CELLS)) : 0
  return { filled, empty: BAR_CELLS - filled }
}

export const level = (percent: number): Color => (percent >= 85 ? 'error' : percent >= 50 ? 'warning' : 'success')

export const toUsage = (context: SessionContextUsage, rateLimits: SessionRateLimit[]): Usage => ({
  tokens: context.tokens,
  window: context.window,
  percent: context.percent,
  limits: rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
})

export const segments = (u: Usage, now: number): Segment[] => {
  const out: Segment[] = []
  if (u.window > 0) {
    out.push({
      label: 'CTX',
      labelColor: 'suggestion',
      percent: u.percent === undefined ? undefined : Math.round(u.percent),
      detail: `${u.tokens === undefined ? '–' : fmtTokens(u.tokens)}/${fmtTokens(u.window)}`,
    })
  }
  for (const r of u.limits) {
    const meta = LIMITS[r.kind] ?? { label: r.kind.toUpperCase(), color: 'text' }
    const resetMs = r.resetsAt ? new Date(r.resetsAt).getTime() : NaN
    const expired = resetMs <= now
    out.push({
      label: meta.label,
      labelColor: meta.color,
      percent: expired ? 0 : Math.round(r.percentUsed),
      reset:
        Number.isNaN(resetMs) || expired
          ? undefined
          : { countdown: fmtCountdown(resetMs, now), at: fmtResetAt(resetMs, now) },
    })
  }
  return out
}

const refresh = async ($: EngineInterface) => {
  const { context, rateLimits } = await $.session.usage()
  await update($, usage, () => toUsage(context, rateLimits))
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if (e.isInteractive) $.clock.every(MINUTE, () => $.ui.invalidate('ui.render'))
    await refresh($)
    return result
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'clear' || e.source === 'compact') await refresh($)
    return result
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsage(e.context, e.rateLimits))
    return next(e)
  })

  if (options.position === 'below') {
    on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
      const band = await drawBand($, e)
      const hint = await next(e)
      if (!band) return hint
      const { Box } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {band}
          {hint}
        </Box>
      )
    })
    return
  }

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    return (await drawBand($, e)) ?? next(e)
  })
}

const drawBand = async ($: EngineInterface, e: RenderInput) => {
  const u = await read($, usage)
  const segs = u ? segments(u, await $.clock.now()) : []
  if (segs.length === 0) return undefined

  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
      {segs.map((s, i) => {
        const { filled, empty } = bar(s.percent ?? 0)
        const tone = s.percent === undefined ? 'inactive' : level(s.percent)
        return (
          <Box key={`${s.label}-${i}`} flexDirection="row" columnGap={1}>
            <Text color={s.labelColor} weight="bold">{s.label}</Text>
            <Box flexDirection="row">
              <Text color={tone}>{'█'.repeat(filled)}</Text>
              <Text color="inactive">{'░'.repeat(empty)}</Text>
            </Box>
            <Text color={tone} weight="bold">{`${s.percent ?? '–'}%`}</Text>
            {s.detail ? <Text dimColor>{s.detail}</Text> : null}
            {s.reset ? <Text color="claude">⏱</Text> : null}
            {s.reset ? <Text color="text" weight="bold">{s.reset.countdown}</Text> : null}
            {s.reset ? <Text color="subtle">{`· ${s.reset.at}`}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}
