import {
  IVehicleAttribute,
  TSpecs,
} from "../../module/vehicleType/vehicleType.interface";

/*
 * Demo catalog for `npm run seed`.
 * Specs are approximate public figures for demonstration — verify before production use.
 */

const option = (value: string, label: string) => ({ value, label });

const ENGINE = "Engine & Performance";
const BRAKES = "Brakes & Safety";
const DIMENSIONS = "Dimensions";
const FEATURES = "Features";

export const BIKE_VEHICLE_TYPE = {
  name: "Bike",
  slug: "bike",
  description: "Motorcycles and scooters",
  icon: "bike",
  sortOrder: 1,
};

export const BIKE_ATTRIBUTES: IVehicleAttribute[] = [
  // ── Engine & Performance ──
  {
    key: "engineCapacity",
    label: "Engine capacity",
    type: "NUMBER",
    unit: "cc",
    min: 50,
    max: 2500,
    step: 0.1,
    required: true,
    filterable: true,
    showInCard: true,
    group: ENGINE,
    sortOrder: 1,
    placeholder: "e.g. 155",
  },
  {
    key: "bikeCategory",
    label: "Category",
    type: "SELECT",
    options: [
      option("commuter", "Commuter"),
      option("sports", "Sports"),
      option("naked", "Naked / Streetfighter"),
      option("cruiser", "Cruiser"),
      option("scooter", "Scooter"),
      option("adventure", "Adventure"),
      option("off-road", "Off-road"),
      option("cafe-racer", "Café racer"),
    ],
    required: true,
    filterable: true,
    showInCard: true,
    group: ENGINE,
    sortOrder: 2,
  },
  {
    key: "fuelType",
    label: "Fuel type",
    type: "SELECT",
    options: [option("petrol", "Petrol"), option("electric", "Electric"), option("hybrid", "Hybrid")],
    required: false,
    filterable: true,
    showInCard: false,
    group: ENGINE,
    sortOrder: 3,
  },
  {
    key: "transmission",
    label: "Transmission",
    type: "SELECT",
    options: [
      option("manual", "Manual"),
      option("automatic", "Automatic (CVT)"),
      option("semi-automatic", "Semi-automatic"),
    ],
    required: false,
    filterable: true,
    showInCard: false,
    group: ENGINE,
    sortOrder: 4,
  },
  {
    key: "gears",
    label: "Gears",
    type: "NUMBER",
    min: 0,
    max: 7,
    step: 1,
    required: false,
    filterable: false,
    showInCard: false,
    group: ENGINE,
    sortOrder: 5,
    helpText: "0 for automatic scooters",
  },
  {
    key: "maxPower",
    label: "Max power",
    type: "NUMBER",
    unit: "bhp",
    min: 0,
    max: 250,
    step: 0.1,
    required: false,
    filterable: false,
    showInCard: false,
    group: ENGINE,
    sortOrder: 6,
  },
  {
    key: "maxTorque",
    label: "Max torque",
    type: "NUMBER",
    unit: "Nm",
    min: 0,
    max: 250,
    step: 0.1,
    required: false,
    filterable: false,
    showInCard: false,
    group: ENGINE,
    sortOrder: 7,
  },
  {
    key: "fuelEconomy",
    label: "Fuel economy",
    type: "NUMBER",
    unit: "km/l",
    min: 0,
    max: 150,
    step: 1,
    required: false,
    filterable: true,
    showInCard: true,
    group: ENGINE,
    sortOrder: 8,
  },
  {
    key: "topSpeed",
    label: "Top speed",
    type: "NUMBER",
    unit: "km/h",
    min: 0,
    max: 400,
    step: 1,
    required: false,
    filterable: false,
    showInCard: false,
    group: ENGINE,
    sortOrder: 9,
  },
  {
    key: "coolingSystem",
    label: "Cooling",
    type: "SELECT",
    options: [option("air", "Air"), option("oil", "Oil"), option("liquid", "Liquid")],
    required: false,
    filterable: false,
    showInCard: false,
    group: ENGINE,
    sortOrder: 10,
  },
  {
    key: "startingSystem",
    label: "Starting",
    type: "SELECT",
    options: [
      option("kick", "Kick"),
      option("self", "Self start"),
      option("kick-and-self", "Kick & self"),
    ],
    required: false,
    filterable: false,
    showInCard: false,
    group: ENGINE,
    sortOrder: 11,
  },

  // ── Brakes & Safety ──
  {
    key: "abs",
    label: "ABS",
    type: "SELECT",
    options: [
      option("none", "No ABS"),
      option("single-channel", "Single-channel"),
      option("dual-channel", "Dual-channel"),
    ],
    required: false,
    filterable: true,
    showInCard: false,
    group: BRAKES,
    sortOrder: 20,
  },
  {
    key: "frontBrake",
    label: "Front brake",
    type: "SELECT",
    options: [option("disc", "Disc"), option("drum", "Drum")],
    required: false,
    filterable: false,
    showInCard: false,
    group: BRAKES,
    sortOrder: 21,
  },
  {
    key: "rearBrake",
    label: "Rear brake",
    type: "SELECT",
    options: [option("disc", "Disc"), option("drum", "Drum")],
    required: false,
    filterable: false,
    showInCard: false,
    group: BRAKES,
    sortOrder: 22,
  },
  {
    key: "tyreType",
    label: "Tyre type",
    type: "SELECT",
    options: [option("tubeless", "Tubeless"), option("tube", "Tube")],
    required: false,
    filterable: false,
    showInCard: false,
    group: BRAKES,
    sortOrder: 23,
  },
  {
    key: "wheelType",
    label: "Wheels",
    type: "SELECT",
    options: [option("alloy", "Alloy"), option("spoke", "Spoke")],
    required: false,
    filterable: false,
    showInCard: false,
    group: BRAKES,
    sortOrder: 24,
  },

  // ── Dimensions ──
  {
    key: "fuelTankCapacity",
    label: "Fuel tank",
    type: "NUMBER",
    unit: "L",
    min: 0,
    max: 40,
    step: 0.1,
    required: false,
    filterable: false,
    showInCard: false,
    group: DIMENSIONS,
    sortOrder: 30,
  },
  {
    key: "kerbWeight",
    label: "Kerb weight",
    type: "NUMBER",
    unit: "kg",
    min: 0,
    max: 500,
    step: 1,
    required: false,
    filterable: false,
    showInCard: false,
    group: DIMENSIONS,
    sortOrder: 31,
  },
  {
    key: "seatHeight",
    label: "Seat height",
    type: "NUMBER",
    unit: "mm",
    min: 0,
    max: 1200,
    step: 1,
    required: false,
    filterable: false,
    showInCard: false,
    group: DIMENSIONS,
    sortOrder: 32,
  },

  // ── Features ──
  {
    key: "features",
    label: "Features",
    type: "MULTI_SELECT",
    options: [
      option("digital-console", "Digital console"),
      option("led-headlight", "LED headlight"),
      option("usb-charging", "USB charging"),
      option("bluetooth", "Bluetooth connectivity"),
      option("mono-shock", "Mono-shock suspension"),
      option("usd-fork", "USD front fork"),
      option("slipper-clutch", "Slipper clutch"),
      option("traction-control", "Traction control"),
    ],
    required: false,
    filterable: true,
    showInCard: false,
    group: FEATURES,
    sortOrder: 40,
  },
];

/*
 * Compact spec builder for seed data.
 */
type TBikeSpecInput = {
  cc: number;
  category: string;
  power: number;
  torque: number;
  economy: number;
  topSpeed: number;
  cooling: "air" | "oil" | "liquid";
  start: "kick" | "self" | "kick-and-self";
  abs: "none" | "single-channel" | "dual-channel";
  front: "disc" | "drum";
  rear: "disc" | "drum";
  tank: number;
  weight: number;
  seat: number;
  gears: number;
  features?: string[];
  tyre?: "tubeless" | "tube";
  wheel?: "alloy" | "spoke";
};

const bike = (input: TBikeSpecInput): TSpecs => ({
  engineCapacity: input.cc,
  bikeCategory: input.category,
  fuelType: "petrol",
  transmission: input.category === "scooter" ? "automatic" : "manual",
  gears: input.gears,
  maxPower: input.power,
  maxTorque: input.torque,
  fuelEconomy: input.economy,
  topSpeed: input.topSpeed,
  coolingSystem: input.cooling,
  startingSystem: input.start,
  abs: input.abs,
  frontBrake: input.front,
  rearBrake: input.rear,
  tyreType: input.tyre ?? "tubeless",
  wheelType: input.wheel ?? "alloy",
  fuelTankCapacity: input.tank,
  kerbWeight: input.weight,
  seatHeight: input.seat,
  features: input.features ?? ["digital-console"],
});

type TSeedModel = {
  name: string;
  yearFrom?: number;
  specs: TSpecs;
};

type TSeedBrand = {
  name: string;
  country: string;
  isPopular: boolean;
  models: TSeedModel[];
};

export const BIKE_BRANDS: TSeedBrand[] = [
  {
    name: "Honda",
    country: "Japan",
    isPopular: true,
    models: [
      {
        name: "CB Hornet 160R",
        yearFrom: 2018,
        specs: bike({ cc: 162.7, category: "naked", power: 15.1, torque: 14.5, economy: 45, topSpeed: 115, cooling: "air", start: "self", abs: "single-channel", front: "disc", rear: "disc", tank: 12, weight: 142, seat: 790, gears: 5, features: ["digital-console", "led-headlight", "mono-shock"] }),
      },
      {
        name: "CBR 150R",
        yearFrom: 2021,
        specs: bike({ cc: 149.2, category: "sports", power: 17.1, torque: 14.4, economy: 40, topSpeed: 130, cooling: "liquid", start: "self", abs: "dual-channel", front: "disc", rear: "disc", tank: 12, weight: 139, seat: 787, gears: 6, features: ["digital-console", "led-headlight", "usd-fork", "mono-shock"] }),
      },
      {
        name: "Livo",
        yearFrom: 2017,
        specs: bike({ cc: 109.5, category: "commuter", power: 8.6, torque: 9.3, economy: 70, topSpeed: 90, cooling: "air", start: "kick-and-self", abs: "none", front: "drum", rear: "drum", tank: 9, weight: 113, seat: 790, gears: 4, features: [] }),
      },
      {
        name: "X-Blade",
        yearFrom: 2019,
        specs: bike({ cc: 162.7, category: "naked", power: 13.9, torque: 13.9, economy: 50, topSpeed: 115, cooling: "air", start: "self", abs: "single-channel", front: "disc", rear: "drum", tank: 12, weight: 140, seat: 795, gears: 5, features: ["digital-console", "led-headlight", "mono-shock"] }),
      },
      {
        name: "Dio",
        yearFrom: 2018,
        specs: bike({ cc: 109.5, category: "scooter", power: 7.7, torque: 9, economy: 55, topSpeed: 85, cooling: "air", start: "kick-and-self", abs: "none", front: "drum", rear: "drum", tank: 5.3, weight: 103, seat: 765, gears: 0, features: ["digital-console", "led-headlight"] }),
      },
    ],
  },
  {
    name: "Yamaha",
    country: "Japan",
    isPopular: true,
    models: [
      {
        name: "R15 V4",
        yearFrom: 2022,
        specs: bike({ cc: 155, category: "sports", power: 18.1, torque: 14.2, economy: 45, topSpeed: 140, cooling: "liquid", start: "self", abs: "dual-channel", front: "disc", rear: "disc", tank: 11, weight: 142, seat: 815, gears: 6, features: ["digital-console", "led-headlight", "bluetooth", "usd-fork", "slipper-clutch", "traction-control"] }),
      },
      {
        name: "FZS FI V3",
        yearFrom: 2019,
        specs: bike({ cc: 149, category: "naked", power: 12.2, torque: 13.3, economy: 45, topSpeed: 115, cooling: "air", start: "self", abs: "single-channel", front: "disc", rear: "drum", tank: 13, weight: 135, seat: 790, gears: 5, features: ["digital-console", "led-headlight", "mono-shock"] }),
      },
      {
        name: "MT-15 V2",
        yearFrom: 2023,
        specs: bike({ cc: 155, category: "naked", power: 18.1, torque: 14.1, economy: 45, topSpeed: 130, cooling: "liquid", start: "self", abs: "dual-channel", front: "disc", rear: "disc", tank: 10, weight: 141, seat: 810, gears: 6, features: ["digital-console", "led-headlight", "usd-fork", "slipper-clutch"] }),
      },
      {
        name: "Fazer FI V2",
        yearFrom: 2018,
        specs: bike({ cc: 149, category: "sports", power: 12.2, torque: 12.8, economy: 45, topSpeed: 115, cooling: "air", start: "self", abs: "single-channel", front: "disc", rear: "drum", tank: 12, weight: 137, seat: 790, gears: 5, features: ["digital-console", "mono-shock"] }),
      },
      {
        name: "Ray ZR 125",
        yearFrom: 2021,
        specs: bike({ cc: 125, category: "scooter", power: 8.2, torque: 10.3, economy: 50, topSpeed: 90, cooling: "air", start: "kick-and-self", abs: "none", front: "drum", rear: "drum", tank: 5.2, weight: 99, seat: 785, gears: 0, features: ["digital-console", "led-headlight"] }),
      },
    ],
  },
  {
    name: "Suzuki",
    country: "Japan",
    isPopular: true,
    models: [
      {
        name: "Gixxer SF FI ABS",
        yearFrom: 2020,
        specs: bike({ cc: 155, category: "sports", power: 13.4, torque: 13.8, economy: 45, topSpeed: 120, cooling: "air", start: "self", abs: "single-channel", front: "disc", rear: "disc", tank: 12, weight: 148, seat: 800, gears: 5, features: ["digital-console", "led-headlight", "mono-shock"] }),
      },
      {
        name: "Gixxer 150",
        yearFrom: 2020,
        specs: bike({ cc: 155, category: "naked", power: 13.4, torque: 13.8, economy: 45, topSpeed: 115, cooling: "air", start: "self", abs: "single-channel", front: "disc", rear: "disc", tank: 12, weight: 141, seat: 795, gears: 5, features: ["digital-console", "led-headlight", "mono-shock"] }),
      },
      {
        name: "GSX-R150",
        yearFrom: 2019,
        specs: bike({ cc: 147.3, category: "sports", power: 18.9, torque: 14, economy: 40, topSpeed: 135, cooling: "liquid", start: "self", abs: "single-channel", front: "disc", rear: "disc", tank: 11, weight: 131, seat: 785, gears: 6, features: ["digital-console", "led-headlight", "mono-shock"] }),
      },
      {
        name: "Access 125",
        yearFrom: 2019,
        specs: bike({ cc: 124, category: "scooter", power: 8.6, torque: 10, economy: 50, topSpeed: 90, cooling: "air", start: "kick-and-self", abs: "none", front: "drum", rear: "drum", tank: 5, weight: 104, seat: 773, gears: 0, features: ["digital-console", "usb-charging"] }),
      },
    ],
  },
  {
    name: "Bajaj",
    country: "India",
    isPopular: true,
    models: [
      {
        name: "Pulsar N160",
        yearFrom: 2022,
        specs: bike({ cc: 164.8, category: "naked", power: 15.7, torque: 14.7, economy: 45, topSpeed: 120, cooling: "oil", start: "self", abs: "dual-channel", front: "disc", rear: "disc", tank: 14, weight: 152, seat: 795, gears: 5, features: ["digital-console", "led-headlight", "usb-charging", "mono-shock"] }),
      },
      {
        name: "Pulsar NS160",
        yearFrom: 2018,
        specs: bike({ cc: 160.3, category: "naked", power: 17, torque: 14.6, economy: 40, topSpeed: 125, cooling: "oil", start: "self", abs: "dual-channel", front: "disc", rear: "disc", tank: 12, weight: 152, seat: 805, gears: 5, features: ["digital-console", "led-headlight", "mono-shock"] }),
      },
      {
        name: "Pulsar 150",
        yearFrom: 2017,
        specs: bike({ cc: 149.5, category: "commuter", power: 13.8, torque: 13.3, economy: 45, topSpeed: 110, cooling: "air", start: "self", abs: "single-channel", front: "disc", rear: "drum", tank: 15, weight: 148, seat: 785, gears: 5 }),
      },
      {
        name: "Discover 125",
        yearFrom: 2017,
        specs: bike({ cc: 124.5, category: "commuter", power: 10.8, torque: 11, economy: 60, topSpeed: 100, cooling: "air", start: "self", abs: "none", front: "drum", rear: "drum", tank: 8, weight: 120, seat: 780, gears: 5, features: [] }),
      },
      {
        name: "Platina 100",
        yearFrom: 2018,
        specs: bike({ cc: 102, category: "commuter", power: 7.8, torque: 8.3, economy: 75, topSpeed: 90, cooling: "air", start: "kick-and-self", abs: "none", front: "drum", rear: "drum", tank: 11, weight: 117, seat: 807, gears: 4, features: [] }),
      },
    ],
  },
  {
    name: "TVS",
    country: "India",
    isPopular: true,
    models: [
      {
        name: "Apache RTR 160 4V",
        yearFrom: 2019,
        specs: bike({ cc: 159.7, category: "naked", power: 17.3, torque: 14.7, economy: 45, topSpeed: 114, cooling: "oil", start: "self", abs: "single-channel", front: "disc", rear: "disc", tank: 12, weight: 145, seat: 800, gears: 5, features: ["digital-console", "led-headlight", "bluetooth", "mono-shock", "slipper-clutch"] }),
      },
      {
        name: "Raider 125",
        yearFrom: 2022,
        specs: bike({ cc: 124.8, category: "commuter", power: 11.2, torque: 11.2, economy: 55, topSpeed: 99, cooling: "air", start: "self", abs: "none", front: "disc", rear: "drum", tank: 10, weight: 123, seat: 780, gears: 5, features: ["digital-console", "led-headlight", "mono-shock"] }),
      },
      {
        name: "Metro Plus 110",
        yearFrom: 2017,
        specs: bike({ cc: 109.7, category: "commuter", power: 8.2, torque: 8.7, economy: 70, topSpeed: 90, cooling: "air", start: "kick-and-self", abs: "none", front: "drum", rear: "drum", tank: 10, weight: 112, seat: 785, gears: 4, features: [] }),
      },
      {
        name: "Ntorq 125",
        yearFrom: 2020,
        specs: bike({ cc: 124.8, category: "scooter", power: 9.3, torque: 10.5, economy: 45, topSpeed: 95, cooling: "air", start: "self", abs: "none", front: "disc", rear: "drum", tank: 5.8, weight: 116, seat: 770, gears: 0, features: ["digital-console", "led-headlight", "bluetooth", "usb-charging"] }),
      },
    ],
  },
  {
    name: "Hero",
    country: "India",
    isPopular: true,
    models: [
      {
        name: "Splendor Plus",
        yearFrom: 2017,
        specs: bike({ cc: 97.2, category: "commuter", power: 7.9, torque: 8.1, economy: 75, topSpeed: 87, cooling: "air", start: "kick-and-self", abs: "none", front: "drum", rear: "drum", tank: 9.8, weight: 112, seat: 785, gears: 4, features: [] }),
      },
      {
        name: "Glamour 125",
        yearFrom: 2019,
        specs: bike({ cc: 124.7, category: "commuter", power: 10.7, torque: 10.6, economy: 60, topSpeed: 99, cooling: "air", start: "self", abs: "none", front: "disc", rear: "drum", tank: 10, weight: 123, seat: 790, gears: 5, features: ["digital-console", "usb-charging"] }),
      },
      {
        name: "Xtreme 160R",
        yearFrom: 2021,
        specs: bike({ cc: 163, category: "naked", power: 15, torque: 14, economy: 45, topSpeed: 118, cooling: "air", start: "self", abs: "single-channel", front: "disc", rear: "disc", tank: 12, weight: 138, seat: 795, gears: 5, features: ["digital-console", "led-headlight", "mono-shock"] }),
      },
    ],
  },
  {
    name: "KTM",
    country: "Austria",
    isPopular: true,
    models: [
      {
        name: "Duke 125",
        yearFrom: 2021,
        specs: bike({ cc: 124.7, category: "naked", power: 14.5, torque: 12, economy: 40, topSpeed: 115, cooling: "liquid", start: "self", abs: "single-channel", front: "disc", rear: "disc", tank: 13.4, weight: 159, seat: 822, gears: 6, features: ["digital-console", "led-headlight", "usd-fork", "mono-shock"] }),
      },
      {
        name: "RC 125",
        yearFrom: 2021,
        specs: bike({ cc: 124.7, category: "sports", power: 14.5, torque: 12, economy: 40, topSpeed: 118, cooling: "liquid", start: "self", abs: "single-channel", front: "disc", rear: "disc", tank: 13.7, weight: 160, seat: 824, gears: 6, features: ["digital-console", "led-headlight", "usd-fork", "mono-shock"] }),
      },
    ],
  },
  {
    name: "Royal Enfield",
    country: "India",
    isPopular: true,
    models: [
      {
        name: "Classic 350",
        yearFrom: 2022,
        specs: bike({ cc: 349, category: "cruiser", power: 20.2, torque: 27, economy: 35, topSpeed: 115, cooling: "oil", start: "self", abs: "dual-channel", front: "disc", rear: "disc", tank: 13, weight: 195, seat: 805, gears: 5, wheel: "spoke", tyre: "tube", features: ["usb-charging"] }),
      },
      {
        name: "Hunter 350",
        yearFrom: 2023,
        specs: bike({ cc: 349, category: "naked", power: 20.2, torque: 27, economy: 36, topSpeed: 114, cooling: "oil", start: "self", abs: "dual-channel", front: "disc", rear: "disc", tank: 13, weight: 181, seat: 790, gears: 5, features: ["digital-console", "usb-charging"] }),
      },
      {
        name: "Meteor 350",
        yearFrom: 2023,
        specs: bike({ cc: 349, category: "cruiser", power: 20.2, torque: 27, economy: 35, topSpeed: 115, cooling: "oil", start: "self", abs: "dual-channel", front: "disc", rear: "disc", tank: 15, weight: 191, seat: 765, gears: 5, features: ["digital-console", "usb-charging", "led-headlight"] }),
      },
    ],
  },
  {
    name: "Runner",
    country: "Bangladesh",
    isPopular: false,
    models: [
      {
        name: "Bullet 100",
        yearFrom: 2016,
        specs: bike({ cc: 97, category: "commuter", power: 7.5, torque: 7.8, economy: 70, topSpeed: 85, cooling: "air", start: "kick-and-self", abs: "none", front: "drum", rear: "drum", tank: 10, weight: 110, seat: 780, gears: 4, wheel: "spoke", tyre: "tube", features: [] }),
      },
      {
        name: "Knight Rider 150 V2",
        yearFrom: 2019,
        specs: bike({ cc: 150, category: "sports", power: 12.5, torque: 12, economy: 40, topSpeed: 110, cooling: "air", start: "self", abs: "none", front: "disc", rear: "drum", tank: 11, weight: 135, seat: 790, gears: 5 }),
      },
    ],
  },
  {
    name: "Lifan",
    country: "China",
    isPopular: false,
    models: [
      {
        name: "KPR 165R",
        yearFrom: 2019,
        specs: bike({ cc: 165, category: "sports", power: 16.5, torque: 14.5, economy: 40, topSpeed: 125, cooling: "liquid", start: "self", abs: "none", front: "disc", rear: "disc", tank: 12, weight: 145, seat: 790, gears: 5, features: ["digital-console", "led-headlight", "mono-shock"] }),
      },
      {
        name: "K19",
        yearFrom: 2020,
        specs: bike({ cc: 165, category: "naked", power: 15.5, torque: 14, economy: 40, topSpeed: 120, cooling: "liquid", start: "self", abs: "none", front: "disc", rear: "disc", tank: 12, weight: 142, seat: 795, gears: 5, features: ["digital-console", "led-headlight", "usd-fork"] }),
      },
    ],
  },
  {
    name: "GPX",
    country: "Thailand",
    isPopular: false,
    models: [
      {
        name: "Demon GR165R",
        yearFrom: 2021,
        specs: bike({ cc: 165, category: "sports", power: 16.6, torque: 14.7, economy: 40, topSpeed: 125, cooling: "liquid", start: "self", abs: "dual-channel", front: "disc", rear: "disc", tank: 13, weight: 143, seat: 790, gears: 5, features: ["digital-console", "led-headlight", "usd-fork", "mono-shock"] }),
      },
      {
        name: "Legend 150S",
        yearFrom: 2020,
        specs: bike({ cc: 150, category: "cafe-racer", power: 12.5, torque: 12.1, economy: 40, topSpeed: 110, cooling: "air", start: "self", abs: "single-channel", front: "disc", rear: "disc", tank: 13, weight: 140, seat: 780, gears: 5, wheel: "spoke", features: ["led-headlight"] }),
      },
    ],
  },
  {
    name: "Kawasaki",
    country: "Japan",
    isPopular: false,
    models: [
      {
        name: "Ninja 125",
        yearFrom: 2021,
        specs: bike({ cc: 125, category: "sports", power: 14.8, torque: 11.7, economy: 40, topSpeed: 125, cooling: "liquid", start: "self", abs: "single-channel", front: "disc", rear: "disc", tank: 11, weight: 148, seat: 785, gears: 6, features: ["digital-console", "led-headlight", "mono-shock"] }),
      },
    ],
  },
];
