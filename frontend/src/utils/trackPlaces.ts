export type TrackPlaceKind = "city" | "coast" | "sea" | "country";

export interface TrackPlace {
  name: string;
  lat: number;
  lon: number;
  kind: TrackPlaceKind;
}

export const TRACK_PLACES: TrackPlace[] = [
  { name: "BAY OF BENGAL", lat: 14.5, lon: 88, kind: "sea" },
  { name: "ANDAMAN SEA", lat: 9, lon: 96, kind: "sea" },
  { name: "ARABIAN SEA", lat: 14, lon: 71, kind: "sea" },
  { name: "GULF OF MANNAR", lat: 8.5, lon: 79.5, kind: "sea" },
  { name: "PALK BAY", lat: 9.5, lon: 80, kind: "sea" },
  { name: "MALDIVES", lat: 3.2, lon: 73, kind: "country" },
  { name: "SRI LANKA", lat: 7.8, lon: 80.6, kind: "country" },
  { name: "INDIA", lat: 20.5, lon: 78.5, kind: "country" },
  { name: "BANGLADESH", lat: 23.9, lon: 90.3, kind: "country" },
  { name: "MYANMAR", lat: 21.4, lon: 95.6, kind: "country" },
  { name: "THAILAND", lat: 14.5, lon: 100.5, kind: "country" },
  { name: "ANDAMAN ISLANDS", lat: 11.7, lon: 92.7, kind: "coast" },
  { name: "NICOBAR ISLANDS", lat: 7.3, lon: 93.5, kind: "coast" },
  { name: "Kolkata", lat: 22.57, lon: 88.36, kind: "city" },
  { name: "Haldia", lat: 22.03, lon: 88.11, kind: "city" },
  { name: "Digha", lat: 21.63, lon: 87.55, kind: "coast" },
  { name: "Sagar Island", lat: 21.65, lon: 88.06, kind: "coast" },
  { name: "Balasore", lat: 21.5, lon: 86.93, kind: "city" },
  { name: "Bhubaneswar", lat: 20.3, lon: 85.82, kind: "city" },
  { name: "Paradip", lat: 20.26, lon: 86.63, kind: "coast" },
  { name: "Puri", lat: 19.81, lon: 85.83, kind: "coast" },
  { name: "Gopalpur", lat: 19.29, lon: 84.91, kind: "coast" },
  { name: "Visakhapatnam", lat: 17.69, lon: 83.22, kind: "city" },
  { name: "Srikakulam", lat: 18.3, lon: 83.9, kind: "city" },
  { name: "Vizianagaram", lat: 18.11, lon: 83.4, kind: "city" },
  { name: "Ganjam", lat: 19.3, lon: 84.79, kind: "city" },
  { name: "East Godavari", lat: 16.9, lon: 82.2, kind: "city" },
  { name: "West Godavari", lat: 16.98, lon: 81.78, kind: "city" },
  { name: "Krishna", lat: 16.19, lon: 81.14, kind: "city" },
  { name: "Guntur", lat: 16.3, lon: 80.44, kind: "city" },
  { name: "Nellore", lat: 14.44, lon: 79.99, kind: "city" },
  { name: "Rayagada", lat: 19.16, lon: 83.42, kind: "city" },
  { name: "Koraput", lat: 18.81, lon: 82.71, kind: "city" },
  { name: "Kakinada", lat: 16.96, lon: 82.24, kind: "coast" },
  { name: "Chennai", lat: 13.08, lon: 80.27, kind: "city" },
  { name: "Puducherry", lat: 11.93, lon: 79.83, kind: "coast" },
  { name: "Nagapattinam", lat: 10.77, lon: 79.84, kind: "coast" },
  { name: "Jaffna", lat: 9.66, lon: 80.02, kind: "city" },
  { name: "Trincomalee", lat: 8.57, lon: 81.23, kind: "coast" },
  { name: "Colombo", lat: 6.93, lon: 79.85, kind: "city" },
  { name: "Cox's Bazar", lat: 21.43, lon: 92.01, kind: "coast" },
  { name: "Chittagong", lat: 22.36, lon: 91.78, kind: "city" },
  { name: "Dhaka", lat: 23.81, lon: 90.41, kind: "city" },
  { name: "Mongla", lat: 22.49, lon: 89.61, kind: "coast" },
  { name: "Sittwe", lat: 20.15, lon: 92.9, kind: "coast" },
  { name: "Yangon", lat: 16.87, lon: 96.2, kind: "city" },
  { name: "Port Blair", lat: 11.62, lon: 92.73, kind: "coast" },
];