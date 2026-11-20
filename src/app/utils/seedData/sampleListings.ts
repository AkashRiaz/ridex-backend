/*
 * Demo listings for `npm run seed` — fictional, approved, without photos.
 * brand/model are seed slugs from bikeCatalog.ts.
 */

type TSampleListing = {
  seller: "seller" | "dealer";
  brand: string;
  model: string;
  year: number;
  price: number;
  mileage: number;
  condition: "NEW" | "USED" | "RECONDITIONED";
  isNegotiable: boolean;
  color: string;
  division: string;
  district: string;
  area: string;
  description: string;
};

export const SAMPLE_LISTINGS: TSampleListing[] = [
  { seller: "dealer", brand: "yamaha", model: "r15-v4", year: 2024, price: 585000, mileage: 0, condition: "NEW", isNegotiable: false, color: "Racing Blue", division: "Dhaka", district: "Dhaka", area: "Tejgaon", description: "Brand new R15 V4 with dual-channel ABS and quick shifter. Registration support available from our showroom." },
  { seller: "seller", brand: "yamaha", model: "r15-v4", year: 2023, price: 495000, mileage: 8200, condition: "USED", isNegotiable: true, color: "Metallic Red", division: "Dhaka", district: "Dhaka", area: "Mirpur", description: "Single owner, all papers clear. Serviced at the authorised service centre every 3,000 km. New tyres fitted last month." },
  { seller: "seller", brand: "yamaha", model: "fzs-fi-v3", year: 2022, price: 245000, mileage: 15400, condition: "USED", isNegotiable: true, color: "Matte Black", division: "Dhaka", district: "Gazipur", area: "Tongi", description: "Daily commuter in great condition. Minor scratches on the tank cover, engine is smooth. Tax token valid till next year." },
  { seller: "dealer", brand: "yamaha", model: "mt-15-v2", year: 2024, price: 545000, mileage: 0, condition: "NEW", isNegotiable: false, color: "Ice Fluo-Vermillion", division: "Chattogram", district: "Chattogram", area: "Agrabad", description: "New MT-15 V2 in stock. EMI available on selected cards. Visit our Agrabad showroom for a test ride." },
  { seller: "seller", brand: "honda", model: "cb-hornet-160r", year: 2021, price: 198000, mileage: 21000, condition: "USED", isNegotiable: true, color: "Sports Red", division: "Dhaka", district: "Narayanganj", area: "Chashara", description: "Well maintained Hornet. Original paint, no accident history. Selling because I am moving abroad." },
  { seller: "dealer", brand: "honda", model: "cbr-150r", year: 2023, price: 520000, mileage: 3500, condition: "RECONDITIONED", isNegotiable: false, color: "Tricolour", division: "Dhaka", district: "Dhaka", area: "Uttara", description: "Showroom reconditioned CBR 150R with dual-channel ABS. Full inspection report and 6-month engine warranty included." },
  { seller: "seller", brand: "honda", model: "livo", year: 2020, price: 98000, mileage: 32000, condition: "USED", isNegotiable: true, color: "Black", division: "Rajshahi", district: "Rajshahi", area: "Shaheb Bazar", description: "Excellent mileage, perfect for daily office use. Battery replaced recently." },
  { seller: "seller", brand: "honda", model: "dio", year: 2022, price: 155000, mileage: 9000, condition: "USED", isNegotiable: false, color: "Pearl White", division: "Dhaka", district: "Dhaka", area: "Dhanmondi", description: "Scooter used by a lady rider, garage kept. Very light and easy to ride in city traffic." },
  { seller: "dealer", brand: "suzuki", model: "gixxer-sf-fi-abs", year: 2024, price: 342000, mileage: 0, condition: "NEW", isNegotiable: false, color: "Metallic Triton Blue", division: "Khulna", district: "Khulna", area: "Sonadanga", description: "New Gixxer SF FI ABS. Free first three services and registration assistance." },
  { seller: "seller", brand: "suzuki", model: "gixxer-150", year: 2021, price: 185000, mileage: 18500, condition: "USED", isNegotiable: true, color: "Glass Sparkle Black", division: "Sylhet", district: "Sylhet", area: "Zindabazar", description: "Good condition, recently serviced. Chain sprocket kit changed at 17,000 km." },
  { seller: "seller", brand: "suzuki", model: "access-125", year: 2023, price: 168000, mileage: 4200, condition: "USED", isNegotiable: true, color: "Metallic Matte Grey", division: "Chattogram", district: "Cumilla", area: "Kandirpar", description: "Almost new scooter with USB charger. Selling because I bought a car." },
  { seller: "dealer", brand: "bajaj", model: "pulsar-n160", year: 2024, price: 265000, mileage: 0, condition: "NEW", isNegotiable: false, color: "Racing Red", division: "Dhaka", district: "Dhaka", area: "Bangla Motor", description: "Pulsar N160 dual-channel ABS, brand new. Exchange offer available for your old bike." },
  { seller: "seller", brand: "bajaj", model: "pulsar-ns160", year: 2020, price: 158000, mileage: 26000, condition: "USED", isNegotiable: true, color: "Burnt Red", division: "Rangpur", district: "Rangpur", area: "Jahaj Company Mor", description: "Powerful and reliable. Front tyre new, rear 60%. All documents up to date." },
  { seller: "seller", brand: "bajaj", model: "discover-125", year: 2019, price: 82000, mileage: 41000, condition: "USED", isNegotiable: true, color: "Blue", division: "Barishal", district: "Barishal", area: "Nathullabad", description: "Budget commuter in running condition. Engine never opened." },
  { seller: "seller", brand: "bajaj", model: "platina-100", year: 2021, price: 85000, mileage: 19000, condition: "USED", isNegotiable: false, color: "Ebony Black", division: "Mymensingh", district: "Mymensingh", area: "Ganginarpar", description: "Super fuel efficient, around 75 km/l on highway. Ideal first bike." },
  { seller: "dealer", brand: "tvs", model: "apache-rtr-160-4v", year: 2024, price: 279000, mileage: 0, condition: "NEW", isNegotiable: false, color: "Matte Blue", division: "Dhaka", district: "Dhaka", area: "Mohakhali", description: "Brand new Apache RTR 160 4V with Bluetooth SmartXonnect and slipper clutch." },
  { seller: "seller", brand: "tvs", model: "ntorq-125", year: 2022, price: 148000, mileage: 11000, condition: "USED", isNegotiable: true, color: "Race Edition Yellow", division: "Dhaka", district: "Dhaka", area: "Badda", description: "Ntorq Race Edition with connected console. One minor scratch on the side panel." },
  { seller: "seller", brand: "hero", model: "splendor-plus", year: 2021, price: 92000, mileage: 23000, condition: "USED", isNegotiable: true, color: "Heavy Grey", division: "Chattogram", district: "Feni", area: "Feni Sadar", description: "Very economical, never had any major issue. Kick and self start both working." },
  { seller: "seller", brand: "hero", model: "xtreme-160r", year: 2022, price: 182000, mileage: 14000, condition: "USED", isNegotiable: true, color: "Sports Red", division: "Khulna", district: "Jashore", area: "Doratana", description: "Sporty and light. Original LED headlight and digital meter. Insurance valid." },
  { seller: "dealer", brand: "ktm", model: "duke-125", year: 2023, price: 430000, mileage: 2100, condition: "RECONDITIONED", isNegotiable: false, color: "Electronic Orange", division: "Dhaka", district: "Dhaka", area: "Gulshan", description: "Reconditioned Duke 125 with USD forks. Checked on 120 points, comes with a 3-month warranty." },
  { seller: "seller", brand: "royal-enfield", model: "classic-350", year: 2023, price: 685000, mileage: 6500, condition: "USED", isNegotiable: true, color: "Halcyon Green", division: "Dhaka", district: "Dhaka", area: "Bashundhara", description: "Classic 350 in mint condition with dual-channel ABS. Extra crash guard and touring seat included." },
  { seller: "seller", brand: "runner", model: "knight-rider-150-v2", year: 2021, price: 115000, mileage: 17000, condition: "USED", isNegotiable: true, color: "Black Red", division: "Rajshahi", district: "Bogura", area: "Satmatha", description: "Local brand with easy parts availability. Good running condition." },
  { seller: "seller", brand: "lifan", model: "kpr-165r", year: 2022, price: 205000, mileage: 9800, condition: "USED", isNegotiable: true, color: "Racing Blue", division: "Dhaka", district: "Tangail", area: "Tangail Sadar", description: "Liquid cooled sports bike at a budget price. Smooth engine, no oil leaks." },
  { seller: "dealer", brand: "gpx", model: "demon-gr165r", year: 2024, price: 395000, mileage: 0, condition: "NEW", isNegotiable: false, color: "Black Gold", division: "Chattogram", district: "Chattogram", area: "GEC Circle", description: "New GPX Demon GR165R with dual-channel ABS and USD forks. Limited stock." },
];
