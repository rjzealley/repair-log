import type { EventSummary } from '../types'

interface Props {
  events: EventSummary[]
}

function dateLabel(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  const day = date.getUTCDate()
  const month = date.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })
  const suffix = day % 100 >= 11 && day % 100 <= 13
    ? 'th'
    : (['th', 'st', 'nd', 'rd'][day % 10] ?? 'th')
  return { month: month.slice(0, 3), full: `${day}${suffix} ${month} ${date.getUTCFullYear()}` }
}

export function RepairTrends({ events }: Props) {
  if (events.length === 0) {
    return <p className="trend-message">No past events found.</p>
  }

  const chronological = [...events].reverse().map((event) => ({ ...event, date: dateLabel(event.ev_date) }))
  const maxCount = Math.max(1, ...chronological.map((event) => event.total_repairs), ...chronological.map((event) => event.fixed_repairs))
  const x = (index: number) => chronological.length === 1 ? 300 : 52 + (index * 520) / (chronological.length - 1)
  const y = (count: number) => 180 - (count / maxCount) * 156
  const points = (field: 'total_repairs' | 'fixed_repairs') =>
    chronological.map((event, index) => `${x(index)},${y(event[field])}`).join(' ')

  return (
    <>
      <div className="trend-legend">
        <span><i className="trend-key trend-key-repairs" aria-hidden="true" /> Total repairs</span>
        <span><i className="trend-key trend-key-fixed" aria-hidden="true" /> Total fixed</span>
      </div>
      <svg className="trend-chart" viewBox="0 0 600 220" role="img" aria-label="Total repairs and fixed repairs for the last 12 events">
        <desc>
          {`Events are ordered from oldest to newest. ${chronological.map((event) => (
            `${event.date.full}, ${event.venue_name ?? 'Unknown venue'}: ${event.total_repairs} repairs, ${event.fixed_repairs} fixed`
          )).join('; ')}.`}
        </desc>
        <line x1="52" y1="24" x2="572" y2="24" className="trend-gridline" />
        <line x1="52" y1="180" x2="572" y2="180" className="trend-gridline" />
        <text x="44" y="28" textAnchor="end">{maxCount}</text>
        <text x="44" y="184" textAnchor="end">0</text>
        <polyline points={points('total_repairs')} className="trend-line trend-line-repairs" />
        <polyline points={points('fixed_repairs')} className="trend-line trend-line-fixed" />
        {chronological.map((event, index) => (
          <g key={event.event_id}>
            <circle cx={x(index)} cy={y(event.total_repairs)} r="4" className="trend-point-repairs">
              <title>{`${event.date.full}: ${event.total_repairs} repairs`}</title>
            </circle>
            <circle cx={x(index)} cy={y(event.fixed_repairs)} r="3" className="trend-point-fixed">
              <title>{`${event.date.full}: ${event.fixed_repairs} fixed`}</title>
            </circle>
            <text x={x(index)} y="208" textAnchor="middle">
              <title>{event.date.full}</title>
              {event.date.month}
            </text>
          </g>
        ))}
      </svg>
    </>
  )
}
