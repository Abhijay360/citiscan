import type { Label } from "@/lib/types";

// Validated with the dataviz palette checker across all pairs (the map shows every color next to every other):
// worst colorblind separation dE 19 (deuteranopia). The old green/red pair was dE 5, i.e. the same color for
// red-green colorblind riders. Amber is low-contrast on white, so it always ships with a text label.
export const LABEL_COLORS: Record<Label, string> = {
  likely: "#255be3", // Citi blue
  maybe: "#f59e0b",
  unlikely: "#dc2626",
};
export const NO_DATA_COLOR = "#9ca3af";

// Size is the second cue after color: the riskier the station, the bigger its dot.
export const LABEL_RADIUS: Record<Label, number> = { likely: 4.5, maybe: 5.5, unlikely: 6.5 };

export const LABEL_TEXT: Record<Label, string> = {
  likely: "Likely",
  maybe: "Maybe",
  unlikely: "Unlikely",
};
