import { atom, read, update } from 'claude-code'
import type { Color, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Usage } from '../types'

const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, null)
const tick = atom({ plugin: 'usage-band', key: 'tick' } as const, 0)

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

const dayIndex = (d: Date) => Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / DAY)

export const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

export const fmtCountdown = (resetMs: number, now: number) => {
  const left = resetMs - now
  if (left <= 0) return 'now'
  if (left < HOUR) return `${Math.ceil(left / MINUTE)}m`
  if (left < DAY) return `${Math.floor(left / HOUR)}h${pad(Math.floor((left % HOUR) / MINUTE))}m`
  return `${Math.floor(left / DAY)}d${pad(Math.floor((left % DAY) / HOUR))}h`
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
    out.push({
      label: meta.label,
      labelColor: meta.color,
      percent: Math.round(r.percentUsed),
      reset: Number.isNaN(resetMs)
        ? undefined
        : { countdown: fmtCountdown(resetMs, now), at: fmtResetAt(resetMs, now) },
    })
  }
  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { context, rateLimits } = await $.session.usage()
    await update($, usage, () => toUsage(context, rateLimits))
    $.clock.every(MINUTE, () => {
      void update($, tick, n => n + 1)
    })
    return result
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    const { context, rateLimits } = await $.session.usage()
    await update($, usage, () => toUsage(context, rateLimits))
    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsage(e.context, e.rateLimits))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const u = await read($, usage)
    await read($, tick)
    const segs = u ? segments(u, await $.clock.now()) : []
    if (segs.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
        {segs.map(s => {
          const { filled, empty } = bar(s.percent ?? 0)
          const tone = s.percent === undefined ? 'inactive' : level(s.percent)
          return (
            <Box key={s.label} flexDirection="row" columnGap={1}>
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
  })
}
