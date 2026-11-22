export const formatDate = (dateValue: string): string => {
  const isoMatch = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (!isoMatch) {
    return dateValue
  }

  const [, year, month, day] = isoMatch
  return `${day}/${month}/${year}`
}

export const parseOptionalNumber = (value: string): number => {
  if (!value.trim()) {
    return 0
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

