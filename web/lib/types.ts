// Shapes shared by the API routes and the browser.

export type Label = "likely" | "maybe" | "unlikely";

/** One station in the /api/predict response. */
export type StationPrediction = {
  id: string; // GBFS station_id
  shortName: string; // GBFS short_name, the id used in trip data and the flow table
  name: string;
  lat: number;
  lon: number;
  capacity: number;
  bikes: number; // right now
  ebikes: number; // right now, how many of `bikes` are e-bikes
  docks: number; // right now
  expectedChange: number; // bikes expected to arrive minus leave before the arrival time
  predictedBikes: number; // at the arrival time
  predictedDocks: number;
  pDock: number; // chance at least one dock is open at the arrival time
  pBike: number; // chance at least one bike is available at the arrival time
  dockLabel: Label;
  bikeLabel: Label;
  isRenting: boolean; // station is letting people take bikes right now
  isReturning: boolean; // station is accepting bikes right now
  hasHistory: boolean; // false for new stations: prediction = current count
  rebalanced: boolean; // flows exceed what the station can hold, so Citi Bike moves bikes here
  actualDocks?: number; // replays only: what was really logged at the arrival time
  actualBikes?: number;
};

/** A real past moment from our logs (pipeline/make_replays.py), minus the per-station counts. */
export type ReplayInfo = {
  id: string;
  title: string;
  mode: "dock" | "bike";
  source: string;
  now: string;
  offsets: number[]; // minutes after `now` with logged counts
  center: [number, number];
  stats: { filled: number; filled_warned: number; emptied: number; emptied_warned: number };
};

/** GET /api/timeline: one station's chance of a dock / bike for each minute of the next 30. */
export type TimelineResponse = {
  now: string;
  points: { minutes: number; pDock: number; pBike: number }[];
  actual?: { minutes: number; docks: number; bikes: number }[]; // replays only: what was really logged
};

export type PredictResponse = {
  now: string; // ISO time the prediction starts from
  at: string; // ISO arrival time
  feedUpdated: string; // when Citi Bike last updated the live counts
  speedKmh: { classic: number; ebike: number };
  replay?: ReplayInfo;
  stations: StationPrediction[];
};
