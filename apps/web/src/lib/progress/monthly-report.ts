// The parser and the sentence builder are shared with the mobile app (packages/i18n/src/monthly-report.ts), so both describe a month the same way.
export {
  buildMonthlyView,
  circleMonthlyLines,
  monthLabel,
  parseCircleMonthly,
  parseMonthlyList,
  parseMonthlyPayload,
  type CircleMonthlyRow,
  type MonthlyPayload,
  type MonthlyReportView,
} from "@tarragon/i18n";
