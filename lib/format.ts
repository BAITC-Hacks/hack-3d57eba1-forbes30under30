const number = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
});
const delta = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
  signDisplay: "always",
});
const score = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const scoreDelta = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "always",
});

const format = (value: number, formatter: Intl.NumberFormat): string => (
  Number.isFinite(value) ? formatter.format(value).replace("-", "−") : "—"
);

export const formatNumber = (value: number): string => format(value, number);
export const formatDelta = (value: number): string => format(value, delta);
export const formatScore = (value: number): string => format(value, score);
export const formatScoreDelta = (value: number): string => format(value, scoreDelta);
