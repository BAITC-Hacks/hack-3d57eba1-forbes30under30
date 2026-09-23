const number = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const delta = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "always",
});

export const formatNumber = (value: number): string => Number.isFinite(value) ? number.format(value) : "—";
export const formatDelta = (value: number): string => Number.isFinite(value) ? delta.format(value) : "—";
