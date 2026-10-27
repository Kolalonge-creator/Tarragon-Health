/**
 * The multi-year biomarker trend rules (S43, spec 2.5) live in @tarragon/shared so the phone shows exactly what the web shows. This file keeps
 * the old import path working.
 */
export {
  chartGeometry,
  displayCode,
  groupByUnit,
  labRangeLabel,
  parseTrend,
  positionInLabRange,
  targetLabel,
  unitKey,
  type ChartGeometry,
  type TrendPoint,
  type TrendSeries,
  type TrendTarget,
} from "@tarragon/shared";
